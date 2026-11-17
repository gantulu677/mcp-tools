import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js";
import { Hono } from "npm:hono@^4.9.7";
import { cors } from "npm:hono@^4.9.7/cors";
import { z } from "npm:zod@^4.1.13";

const FUNCTION_NAME = "agent-tools";
const SERVER_VERSION = "1.0.0";
const UPLOAD_UI_URI = "ui://agent-tools/upload-image-v1.html";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const ALLOWED_DOWNLOAD_HOSTS = ["oaiusercontent.com", "chatgpt.com", "oaisdmntprindiasocentral.blob.core.windows.net"];

const app = new Hono();

const uploadUiHtml = [
  "<!doctype html>",
  '<html lang="id"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
  "<title>Image Prompt Studio</title>",
  "<style>",
  ":root{color-scheme:light dark;font-family:system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
  "body{margin:0;padding:16px;color:var(--color,inherit)}.wrap{display:grid;gap:14px;max-width:680px}",
  "h2{font-size:17px;margin:0 0 4px;font-weight:700}h3{font-size:14px;margin:0 0 8px}.sub{font-size:13px;opacity:.72;margin:0;line-height:1.5}",
  "form,.panel{display:grid;gap:10px}.field{display:grid;gap:5px}label{font-size:12px;font-weight:650}input,textarea{box-sizing:border-box;width:100%;padding:10px 11px;border:1px solid color-mix(in srgb,currentColor 22%,transparent);border-radius:9px;background:transparent;color:inherit;font:inherit;font-size:13px}textarea{min-height:70px;resize:vertical}",
  "button{display:flex;align-items:center;justify-content:center;width:100%;padding:12px 15px;border:0;border-radius:10px;background:#2563eb;color:white;font-weight:650;font-size:14px;cursor:pointer}button:disabled{opacity:.55;cursor:wait}",
  ".panel{padding:13px;border:1px solid color-mix(in srgb,currentColor 18%,transparent);border-radius:12px}.hidden{display:none}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:12px/1.55 ui-monospace,monospace;max-height:360px;overflow:auto;margin:0}#status{font-size:12px;line-height:1.5;overflow-wrap:anywhere;min-height:18px;opacity:.85}.success{padding:10px;border-radius:10px;background:color-mix(in srgb,#16a34a 12%,transparent)}",
  "</style></head><body><main class='wrap'>",
  "<header><h2>Image Prompt Studio</h2><p class='sub'>Isi delapan variabel, susun prompt, lalu minta ChatGPT membuat gambar. Setelah gambar siap, pilih file untuk mengunggahnya ke Supabase.</p></header>",
  "<form id='promptForm'>",
  "<div class='field'><label for='products'>Products</label><textarea id='products' name='products' required placeholder='Contoh: Apple Watch Series 10'></textarea></div>",
  "<div class='field'><label for='headline'>Headline</label><textarea id='headline' name='headline' required></textarea></div>",
  "<div class='field'><label for='subheadline'>Subheadline</label><textarea id='subheadline' name='subheadline' required></textarea></div>",
  "<div class='field'><label for='features'>Features</label><textarea id='features' name='features' required></textarea></div>",
  "<div class='field'><label for='composition'>Composition</label><textarea id='composition' name='composition' required></textarea></div>",
  "<div class='field'><label for='layout'>Layout</label><textarea id='layout' name='layout' required></textarea></div>",
  "<div class='field'><label for='background'>Background</label><textarea id='background' name='background' required></textarea></div>",
  "<div class='field'><label for='quality'>Visual Quality</label><textarea id='quality' name='quality' required></textarea></div>",
  "<button id='generate' type='submit'>Generate Prompt</button></form>",
  "<section id='preview' class='panel hidden'><div><h3>Prompt Preview</h3><p class='sub'>Periksa prompt sebelum mengirimkannya ke ChatGPT Image Generation.</p></div><pre id='promptText'></pre><button id='createImage' type='button'>Use Prompt in ChatGPT</button></section>",
  "<section id='uploadPanel' class='panel hidden'><div><h3>Upload Generated Image</h3><p class='sub'>Pilih file gambar hasil generasi ChatGPT. Upload hanya berjalan setelah tombol ditekan.</p></div><input id='file' type='file' accept='image/png,image/jpeg,image/webp'><button id='upload' type='button'>Upload Image to Supabase</button></section>",
  "<div id='status' role='status' aria-live='polite'>PNG, JPEG, atau WEBP · Maksimum 10 MB.</div>",
  "</main><script>",
  "const api=window.openai;const form=document.getElementById('promptForm');const generateButton=document.getElementById('generate');const preview=document.getElementById('preview');const promptText=document.getElementById('promptText');const createImage=document.getElementById('createImage');const uploadPanel=document.getElementById('uploadPanel');const picker=document.getElementById('file');const uploadButton=document.getElementById('upload');const statusEl=document.getElementById('status');let finalPrompt='';let lastPrompt='';",
  "function status(message,success){statusEl.className=success?'success':'';statusEl.textContent=message;}function showUpload(){uploadPanel.classList.remove('hidden');}",
  "const toolInput=api?.toolInput||{};if(typeof toolInput.prompt==='string')lastPrompt=toolInput.prompt;if(toolInput.image||toolInput.status==='awaiting_file')showUpload();",
  "window.addEventListener('message',event=>{if(event.source!==window.parent)return;const m=event.data;if(m?.method==='ui/notifications/tool-input'){const p=m.params||{};if(typeof p.prompt==='string')lastPrompt=p.prompt;if(p.image||p.status==='awaiting_file')showUpload();}});",
  "form.addEventListener('submit',async event=>{event.preventDefault();if(!api?.callTool){status('Host tidak menyediakan pemanggilan tool. Jalankan tool generate dari percakapan.',false);return;}const data=Object.fromEntries(new FormData(form).entries());generateButton.disabled=true;status('Menyusun prompt…',false);try{const result=await api.callTool('generate',data);const output=result?.structuredContent||{};if(!output.success||!output.final_prompt)throw new Error('Tool generate tidak mengembalikan prompt.');finalPrompt=output.final_prompt;lastPrompt=finalPrompt;promptText.textContent=finalPrompt;preview.classList.remove('hidden');status('Prompt berhasil dibuat. Periksa lalu tekan Use Prompt in ChatGPT.',true);}catch(error){status(error?.message||'Gagal menyusun prompt.',false);}finally{generateButton.disabled=false;}});",
  "createImage.addEventListener('click',()=>{if(!finalPrompt)return;if(api?.sendFollowUpMessage){api.sendFollowUpMessage({prompt:'Buat gambar menggunakan prompt berikut. Jangan mengubah isi prompt.\\n\\n'+finalPrompt});status('Prompt dikirim ke percakapan ChatGPT untuk pembuatan gambar.',true);}else{status('Salin prompt di atas dan minta ChatGPT membuat gambar.',false);}});",
  "uploadButton.addEventListener('click',()=>{if(!api?.uploadFile||!api?.getFileDownloadUrl||!api?.callTool){status('Fitur upload file ChatGPT tidak tersedia. Lampirkan gambar di percakapan lalu panggil upload_image.',false);return;}picker.click();});",
  "picker.addEventListener('change',async()=>{const file=picker.files?.[0];if(!file)return;if(!['image/png','image/jpeg','image/webp'].includes(file.type)){status('Format tidak didukung. Gunakan PNG, JPEG, atau WEBP.',false);picker.value='';return;}if(file.size>10*1024*1024){status('Ukuran gambar melebihi batas 10 MB.',false);picker.value='';return;}uploadButton.disabled=true;status('Mengirim file ke ChatGPT…',false);try{const uploaded=await api.uploadFile(file);const fileId=uploaded?.fileId;if(!fileId)throw new Error('ChatGPT tidak mengembalikan file ID.');const fileUrl=await api.getFileDownloadUrl({fileId});if(!fileUrl?.downloadUrl)throw new Error('URL download sementara tidak tersedia.');const result=await api.callTool('upload_image',{image:{download_url:fileUrl.downloadUrl,file_id:fileId,mime_type:file.type,file_name:file.name},prompt:lastPrompt});const data=result?.structuredContent||{};if(data.success&&data.image?.image_url){status('Upload berhasil. Public URL: '+data.image.image_url,true);}else{const message=(result?.content||[]).map(x=>x.text||'').filter(Boolean).join(' ');throw new Error(message||'Upload gagal.');}}catch(error){status(error?.message||'Upload gagal. Silakan coba kembali.',false);}finally{uploadButton.disabled=false;picker.value='';}});",
  "</script></body></html>"
].join("\n");

function buildFinalPrompt(input: {
  products: string;
  headline: string;
  subheadline: string;
  features: string;
  composition: string;
  layout: string;
  background: string;
  quality: string;
}): string {
  return [
    "Create a professional commercial advertising poster featuring:",
    "",
    "**PRODUCT:** " + input.products,
    "",
    "**HEADLINE:** " + input.headline,
    "",
    "**SUBHEADLINE:** " + input.subheadline,
    "",
    "**PRODUCT FEATURES:**",
    input.features,
    "",
    "**COMPOSITION:**",
    input.composition,
    "",
    "**LAYOUT:**",
    input.layout,
    "",
    "**BACKGROUND:**",
    input.background,
    "",
    "**VISUAL QUALITY:**",
    input.quality,
    "",
    "## Design Requirements",
    "",
    "- Create a premium, professional advertising design.",
    "- Make the selected product the primary visual focus.",
    "- Maintain realistic product proportions and details.",
    "- Use professional commercial photography aesthetics.",
    "- Ensure clear visual hierarchy.",
    "- Make headline and subheadline visually readable.",
    "- Arrange all elements harmoniously.",
    "- Avoid unnecessary decorative elements.",
    "- Do not create, redraw, or generate any logo.",
    "- Leave the top-left area suitable for a small logo overlay.",
    "",
    "## Output Requirements",
    "",
    "- Image dimensions: 1080 × 1350 pixels.",
    "- Aspect ratio: 4:5.",
    "- High-resolution commercial advertising quality.",
    "- Ready for social media publication."
  ].join("\n");
}

function isAllowedDownloadUrl(rawUrl: string): URL {
  const parsed = new URL(rawUrl);
  const hostname = parsed.hostname.toLowerCase();
  const allowed = ALLOWED_DOWNLOAD_HOSTS.some((host) => hostname === host || hostname.endsWith("." + host));
  if (parsed.protocol !== "https:" || !allowed || parsed.username || parsed.password || (parsed.port && parsed.port !== "443")) {
    throw new Error("Attachment download URL is not from an allowed HTTPS host.");
  }
  return parsed;
}

function detectImageMime(bytes: Uint8Array): typeof ALLOWED_MIME_TYPES[number] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
      bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

async function downloadImage(image: {
  download_url: string;
  file_id: string;
  mime_type?: string;
  file_name?: string;
}): Promise<{ bytes: Uint8Array; mimeType: typeof ALLOWED_MIME_TYPES[number] }> {
  isAllowedDownloadUrl(image.download_url);
  const response = await fetch(image.download_url, { redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Could not download the ChatGPT image attachment.");

  const declaredLength = Number(response.headers.get("content-length") || "0");
  if (declaredLength > MAX_IMAGE_BYTES) {
    await response.body.cancel();
    throw new Error("Image exceeds the 10 MB limit.");
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new Error("Image exceeds the 10 MB limit.");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  if (total === 0) throw new Error("The image attachment is empty.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  const actualMime = detectImageMime(bytes);
  if (!actualMime || !ALLOWED_MIME_TYPES.includes(actualMime)) {
    throw new Error("The uploaded file content is not a supported PNG, JPEG, or WEBP image.");
  }
  if (image.mime_type && image.mime_type !== actualMime) {
    throw new Error("The attachment MIME type does not match its actual file content.");
  }
  return { bytes, mimeType: actualMime };
}

function getSupabaseSecretKey(): string {
  const directKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (directKey) return directKey;
  const secretKeysRaw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!secretKeysRaw) throw new Error("Supabase server credentials are not configured.");
  const secretKeys = JSON.parse(secretKeysRaw);
  const secretKey = secretKeys?.default;
  if (typeof secretKey !== "string" || !secretKey) throw new Error("Supabase secret key is missing.");
  return secretKey;
}

function createMcpServer() {
  const server = new McpServer({ name: FUNCTION_NAME, version: SERVER_VERSION });

  server.registerResource("upload-image-app", UPLOAD_UI_URI, {}, async () => ({
    contents: [{
      uri: UPLOAD_UI_URI,
      mimeType: "text/html;profile=mcp-app",
      text: uploadUiHtml,
      _meta: {
        ui: {
          prefersBorder: true
        }
      }
    }]
  }));

  server.registerTool("generate", {
    title: "Generate commercial image prompt",
    description: "Build the final commercial advertising image prompt from all eight manually supplied variables. It does not call an image-generation API. Return the final prompt for ChatGPT to use with its built-in image generation capability. After ChatGPT finishes generating the image, call upload_image without an image argument to show the user the upload control; do not upload until the user selects a file.",
    inputSchema: {
      products: z.string().min(1).max(5000),
      headline: z.string().min(1).max(2000),
      subheadline: z.string().min(1).max(3000),
      features: z.string().min(1).max(10000),
      composition: z.string().min(1).max(2000),
      layout: z.string().min(1).max(2000),
      background: z.string().min(1).max(3000),
      quality: z.string().min(1).max(3000)
    },
    outputSchema: {
      success: z.boolean(),
      final_prompt: z.string(),
      output: z.object({ width: z.number(), height: z.number(), aspect_ratio: z.string() })
    },
    annotations: {
      readOnlyHint: true,
      destructiveHint: false,
      openWorldHint: false
    },
    _meta: {
      ui: { resourceUri: UPLOAD_UI_URI },
      "openai/toolInvocation/invoking": "Menyusun image prompt…",
      "openai/toolInvocation/invoked": "Image prompt siap."
    }
  }, async (input) => {
    const finalPrompt = buildFinalPrompt(input);
    return {
      structuredContent: {
        success: true,
        final_prompt: finalPrompt,
        output: {
          width: 1080,
          height: 1350,
          aspect_ratio: "4:5"
        }
      },
      content: [{
        type: "text",
        text: "Image prompt berhasil disusun. Gunakan final_prompt berikut untuk membuat gambar melalui kemampuan Image Generation bawaan ChatGPT."
      }]
    };
  });

  server.registerTool("upload_image", {
    title: "Upload generated image to Supabase",
    description: "Open the Upload Image control when called without an image. After the user selects a generated image, upload the supplied ChatGPT file attachment to the public Supabase Storage bucket 'image', insert metadata into 'generated_images', and return the public URL. Accepts PNG, JPEG, or WEBP up to 10 MB.",
    inputSchema: {
      image: z.object({
        download_url: z.string().url(),
        file_id: z.string().min(1),
        mime_type: z.string().optional(),
        file_name: z.string().optional()
      }).optional(),
      prompt: z.string().max(10000).optional()
    },
    outputSchema: {
      success: z.boolean(),
      status: z.string(),
      message: z.string().optional(),
      image: z.object({
        id: z.union([z.string(), z.number()]).optional(),
        image_url: z.string(),
        storage_path: z.string(),
        mime_type: z.string(),
        created_at: z.string().optional()
      }).optional()
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: false,
      openWorldHint: false
    },
    _meta: {
      ui: { resourceUri: UPLOAD_UI_URI },
      "openai/outputTemplate": UPLOAD_UI_URI,
      "openai/fileParams": ["image"],
      "openai/toolInvocation/invoking": "Menyiapkan upload gambar…",
      "openai/toolInvocation/invoked": "Upload gambar selesai."
    }
  }, async ({ image, prompt }) => {
    if (!image) {
      return {
        structuredContent: {
          success: true,
          status: "awaiting_file",
          message: "Pilih file gambar melalui tombol Upload Image pada UI."
        },
        content: [{
          type: "text",
          text: "Tombol Upload Image siap. Pengguna harus memilih file gambar sebelum upload dijalankan."
        }]
      };
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured.");

    const { bytes, mimeType } = await downloadImage(image);
    const extension = mimeType === "image/jpeg" ? "jpg" : mimeType === "image/webp" ? "webp" : "png";
    const storagePath = "chatgpt/" + crypto.randomUUID() + "." + extension;
    const admin = createClient(supabaseUrl, getSupabaseSecretKey(), {
      auth: { persistSession: false, autoRefreshToken: false }
    });

    const { error: uploadError } = await admin.storage.from("image").upload(storagePath, bytes, {
      contentType: mimeType,
      cacheControl: "31536000",
      upsert: false
    });
    if (uploadError) throw new Error("Storage upload failed: " + uploadError.message);

    const { data: publicData } = admin.storage.from("image").getPublicUrl(storagePath);
    const { data: row, error: insertError } = await admin.from("generated_images").insert({
      prompt: (prompt || image.file_name || "Generated image uploaded from ChatGPT").slice(0, 10000),
      image_url: publicData.publicUrl,
      storage_path: storagePath,
      mime_type: mimeType
    }).select("id, image_url, storage_path, mime_type, created_at").single();

    if (insertError) {
      const { error: cleanupError } = await admin.storage.from("image").remove([storagePath]);
      if (cleanupError) console.error("Storage rollback failed:", cleanupError.message);
      throw new Error("Image metadata could not be saved: " + insertError.message);
    }

    return {
      structuredContent: {
        success: true,
        status: "uploaded",
        image: row
      },
      content: [{
        type: "text",
        text: "Gambar berhasil diunggah ke bucket image dan metadata disimpan ke generated_images. Public URL: " + row.image_url
      }]
    };
  });

  return server;
}

app.use("*", cors({
  origin: "*",
  allowHeaders: ["Authorization", "Content-Type", "mcp-session-id", "mcp-protocol-version"],
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  exposeHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version"]
}));

app.all("*", async (c) => {
  const server = createMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

Deno.serve(app.fetch);
