import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import { McpServer } from "npm:@modelcontextprotocol/sdk@1.25.3/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "npm:@modelcontextprotocol/sdk@1.25.3/server/webStandardStreamableHttp.js";
import { Hono } from "npm:hono@4.9.7";
import { cors } from "npm:hono@4.9.7/cors";
import { z } from "npm:zod@4.1.13";
import {
  ImageMagick,
  initializeImageMagick,
  MagickFormat,
  CompositeOperator,
  Gravity,
  Point,
} from "npm:@imagemagick/magick-wasm@0.0.36";

const FUNCTION_NAME = "agent-tools";
const SERVER_VERSION = "2.0.0";
const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
const ALLOWED_MIME_TYPES = ["image/png", "image/jpeg", "image/webp"] as const;
const ALLOWED_DOWNLOAD_HOSTS = [
  "oaiusercontent.com",
  "chatgpt.com",
  "oaisdmntprindiasocentral.blob.core.windows.net",
];
const LOGO_BUCKET = "apple";
const LOGO_PATH = "logo.png";
const OUTPUT_BUCKET = "image";
const OUTPUT_WIDTH = 1080;
const OUTPUT_HEIGHT = 1350;

const wasmBytes = await Deno.readFile(
  new URL("magick.wasm", import.meta.resolve("npm:@imagemagick/magick-wasm@0.0.36")),
);
await initializeImageMagick(wasmBytes);

const app = new Hono();

function getSecretKey(): string {
  const direct = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (direct) return direct;
  const raw = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (!raw) throw new Error("Supabase server credentials are not configured.");
  const keys = JSON.parse(raw);
  if (typeof keys?.default !== "string") throw new Error("Supabase secret key is missing.");
  return keys.default;
}

function adminClient() {
  const url = Deno.env.get("SUPABASE_URL");
  if (!url) throw new Error("SUPABASE_URL is not configured.");
  return createClient(url, getSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function sha256(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value)));
}

async function constantTimeEqual(a: string, b: string): Promise<boolean> {
  const [left, right] = await Promise.all([sha256(a), sha256(b)]);
  let diff = 0;
  for (let i = 0; i < left.length; i++) diff |= left[i] ^ right[i];
  return diff === 0;
}

function validateDownloadUrl(raw: string): URL {
  const url = new URL(raw);
  const host = url.hostname.toLowerCase();
  const allowed = ALLOWED_DOWNLOAD_HOSTS.some((domain) =>
    host === domain || host.endsWith("." + domain)
  );
  if (url.protocol !== "https:" || !allowed || url.username || url.password ||
      (url.port && url.port !== "443")) {
    throw new Error("Image download URL is not from an allowed HTTPS host.");
  }
  return url;
}

function detectMime(bytes: Uint8Array): typeof ALLOWED_MIME_TYPES[number] | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
      bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
      bytes[6] === 0x1a && bytes[7] === 0x0a) return "image/png";
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return "image/webp";
  return null;
}

async function downloadImage(url: string, declaredMime?: string): Promise<Uint8Array> {
  validateDownloadUrl(url);
  const response = await fetch(url, { redirect: "error" });
  if (!response.ok || !response.body) throw new Error("Could not download the generated image.");
  const length = Number(response.headers.get("content-length") || 0);
  if (length > MAX_IMAGE_BYTES) {
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
  if (!total) throw new Error("The image attachment is empty.");
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  const actual = detectMime(bytes);
  if (!actual || !ALLOWED_MIME_TYPES.includes(actual)) {
    throw new Error("Only PNG, JPEG, and WEBP image contents are supported.");
  }
  if (declaredMime && declaredMime !== actual) {
    throw new Error("Declared MIME type does not match the image content.");
  }
  return bytes;
}

function buildPrompt(input: {
  product: string;
  headline: string;
  subheadline: string;
  features: string[];
  composition: string;
  layout: string;
  background: string;
  quality: string;
}): string {
  return [
    "Create a premium commercial advertising poster.",
    "",
    "PRODUCT: " + input.product,
    "HEADLINE: " + input.headline,
    "SUBHEADLINE: " + input.subheadline,
    "PRODUCT FEATURES:",
    ...input.features.map((feature) => "- " + feature),
    "",
    "COMPOSITION: " + input.composition,
    "LAYOUT: " + input.layout,
    "BACKGROUND: " + input.background,
    "VISUAL QUALITY: " + input.quality,
    "",
    "DESIGN RULES:",
    "- Product is the primary visual focus. Preserve realistic product details and proportions.",
    "- Create clear hierarchy and legible typography with a polished commercial photography aesthetic.",
    "- Do not create, redraw, approximate, or generate any logo.",
    "- Keep the top-left corner clear for a small original PNG logo overlay.",
    "",
    "OUTPUT: 1080 x 1350 pixels, 4:5 aspect ratio, high-resolution social media advertising artwork.",
  ].join("\n");
}

function createServer() {
  const server = new McpServer({ name: FUNCTION_NAME, version: SERVER_VERSION });

  server.registerTool("list_products", {
    title: "List active products",
    description: "Read the active product catalog from Supabase. ChatGPT Native chooses one product based on the user's request.",
    inputSchema: { search: z.string().max(200).optional() },
    outputSchema: { products: z.array(z.object({
      id: z.string(), product: z.string(), brand: z.string().nullable(),
      description: z.string().nullable(), features: z.array(z.string()),
    })) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ search }) => {
    let query = adminClient().from("products")
      .select("id,product,brand,description,features")
      .eq("is_active", true).order("product").limit(100);
    if (search?.trim()) query = query.ilike("product", "%" + search.trim() + "%");
    const { data, error } = await query;
    if (error) throw new Error("Could not read products: " + error.message);
    return { structuredContent: { products: data ?? [] }, content: [{ type: "text", text: "Active products: " + (data?.length ?? 0) }] };
  });

  server.registerTool("get_product_details", {
    title: "Get product specifications",
    description: "Read the full specification and feature data for one product selected by ChatGPT Native.",
    inputSchema: { product_id: z.string().uuid() },
    outputSchema: { product: z.object({
      id: z.string(), product: z.string(), brand: z.string().nullable(),
      description: z.string().nullable(), features: z.array(z.string()),
      specifications: z.record(z.string(), z.unknown()),
    }) },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ product_id }) => {
    const { data, error } = await adminClient().from("products")
      .select("id,product,brand,description,features,specifications")
      .eq("id", product_id).eq("is_active", true).single();
    if (error || !data) throw new Error("Product not found or inactive.");
    return { structuredContent: { product: data }, content: [{ type: "text", text: "Product specifications retrieved." }] };
  });

  server.registerTool("generate", {
    title: "Build final image prompt",
    description: "Build a prompt only. ChatGPT Native supplies the selected product and every creative variable, then uses its own native image generation capability. This tool does not call an image API.",
    inputSchema: {
      product_id: z.string().uuid(),
      product: z.string().min(1).max(500),
      headline: z.string().min(1).max(200),
      subheadline: z.string().max(500),
      features: z.array(z.string().min(1).max(300)).min(1).max(12),
      composition: z.string().min(1).max(2000),
      layout: z.string().min(1).max(2000),
      background: z.string().min(1).max(2000),
      quality: z.string().min(1).max(2000),
    },
    outputSchema: {
      success: z.boolean(), final_prompt: z.string(),
      creative: z.object({
        product_id: z.string(), product: z.string(), headline: z.string(),
        subheadline: z.string(), features: z.array(z.string()),
        composition: z.string(), layout: z.string(), background: z.string(), quality: z.string(),
      }),
      output: z.object({ width: z.number(), height: z.number(), aspect_ratio: z.string() }),
    },
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async (input) => {
    const { data: product, error } = await adminClient().from("products")
      .select("id,product").eq("id", input.product_id).eq("is_active", true).single();
    if (error || !product) throw new Error("Selected product does not exist or is inactive.");
    if (product.product !== input.product) throw new Error("Product name does not match product_id.");
    const finalPrompt = buildPrompt(input);
    return {
      structuredContent: {
        success: true, final_prompt: finalPrompt,
        creative: input,
        output: { width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT, aspect_ratio: "4:5" },
      },
      content: [{ type: "text", text: "Final prompt ready. Use ChatGPT Native Image Generation with final_prompt." }],
    };
  });

  server.registerTool("finalize_image", {
    title: "Overlay original logo and upload image",
    description: "Download a user-selected ChatGPT image attachment, validate it, composite the original apple/logo.png at the top-left, resize to 1080x1350, and upload the final PNG to the public image bucket. Returns image_url and storage_path. Do not use an external image-generation API.",
    inputSchema: {
      image: z.object({
        download_url: z.string().url(),
        mime_type: z.string().optional(),
      }),
    },
    outputSchema: {
      success: z.boolean(), image_url: z.string(), storage_path: z.string(),
      mime_type: z.string(), width: z.number(), height: z.number(),
    },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
    _meta: {
      "openai/fileParams": ["image"],
      "openai/toolInvocation/invoking": "Menambahkan logo asli dan mengunggah gambar…",
      "openai/toolInvocation/invoked": "Gambar final berhasil diproses.",
    },
  }, async ({ image }) => {
    const admin = adminClient();
    const sourceBytes = await downloadImage(image.download_url, image.mime_type);
    const { data: logoBlob, error: logoError } = await admin.storage.from(LOGO_BUCKET).download(LOGO_PATH);
    if (logoError || !logoBlob) throw new Error("Original logo apple/logo.png could not be loaded.");
    const logoBytes = new Uint8Array(await logoBlob.arrayBuffer());

    const finalBytes = ImageMagick.read(sourceBytes, (canvas) => {
      const ratio = canvas.width / canvas.height;
      if (Math.abs(ratio - (OUTPUT_WIDTH / OUTPUT_HEIGHT)) > 0.01) {
        throw new Error("Generated image must use a 4:5 aspect ratio before finalization.");
      }
      canvas.resize(OUTPUT_WIDTH, OUTPUT_HEIGHT);
      return ImageMagick.read(logoBytes, (logo) => {
        if (logo.width > 120) {
          const targetHeight = Math.max(1, Math.round(120 * logo.height / logo.width));
          logo.resize(120, targetHeight);
        }
        canvas.composite(logo, CompositeOperator.Over, new Point(36, 36));
        canvas.format = MagickFormat.Png;
        return canvas.write((data) => data);
      });
    });

    const output = new Uint8Array(finalBytes);
    const path = "chatgpt/" + crypto.randomUUID() + ".png";
    const { error: uploadError } = await admin.storage.from(OUTPUT_BUCKET).upload(path, output, {
      contentType: "image/png", cacheControl: "31536000", upsert: false,
    });
    if (uploadError) throw new Error("Final image upload failed: " + uploadError.message);
    const { data: publicData } = admin.storage.from(OUTPUT_BUCKET).getPublicUrl(path);
    return {
      structuredContent: {
        success: true, image_url: publicData.publicUrl, storage_path: path,
        mime_type: "image/png", width: OUTPUT_WIDTH, height: OUTPUT_HEIGHT,
      },
      content: [{ type: "text", text: "Original PNG logo overlaid. Final image uploaded: " + publicData.publicUrl }],
    };
  });

  server.registerTool("save_post", {
    title: "Save completed post",
    description: "Save creative metadata and the final public image URL to public.make_post after finalize_image succeeds.",
    inputSchema: {
      product_id: z.string().uuid(), product: z.string().min(1).max(500),
      headline: z.string().min(1).max(200), subheadline: z.string().max(500).optional(),
      features: z.array(z.string()).max(12), composition: z.string().max(2000),
      layout: z.string().max(2000), background: z.string().max(2000), quality: z.string().max(2000),
      prompt: z.string().min(1).max(10000), image_url: z.string().url(),
      storage_path: z.string().min(1).max(500),
    },
    outputSchema: { success: z.boolean(), post: z.object({ id: z.string(), image_url: z.string(), status: z.string() }) },
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input) => {
    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    if (!supabaseUrl) throw new Error("SUPABASE_URL is not configured.");
    const expectedUrl = adminClient().storage.from(OUTPUT_BUCKET).getPublicUrl(input.storage_path).data.publicUrl;
    if (input.image_url !== expectedUrl || !input.storage_path.startsWith("chatgpt/") ||
        !input.storage_path.endsWith(".png")) {
      throw new Error("Image URL and storage path must refer to a finalized image in the image bucket.");
    }
    const admin = adminClient();
    const { data: product, error: productError } = await admin.from("products")
      .select("id,product").eq("id", input.product_id).eq("is_active", true).single();
    if (productError || !product || product.product !== input.product) throw new Error("Product reference is invalid.");
    const { data: storedImage, error: storedImageError } = await admin.storage.from(OUTPUT_BUCKET).download(input.storage_path);
    if (storedImageError || !storedImage) throw new Error("Final image object does not exist in Storage.");
    const { data: row, error } = await admin.from("make_post").insert({
      product_id: input.product_id, product: input.product, headline: input.headline,
      subheadline: input.subheadline ?? null, features: input.features,
      composition: input.composition, layout: input.layout, background: input.background,
      quality: input.quality, prompt: input.prompt, image_url: input.image_url,
      storage_bucket: OUTPUT_BUCKET, storage_path: input.storage_path,
      mime_type: "image/png", image_width: OUTPUT_WIDTH, image_height: OUTPUT_HEIGHT,
      status: "completed",
    }).select("id,image_url,status").single();
    if (error || !row) throw new Error("Post metadata could not be saved: " + (error?.message ?? "unknown error"));
    return {
      structuredContent: { success: true, post: row },
      content: [{ type: "text", text: "Post saved: " + row.id + " — " + row.image_url }],
    };
  });

  return server;
}

app.use("*", cors({
  origin: "*",
  allowHeaders: ["Authorization", "Content-Type", "mcp-session-id", "mcp-protocol-version"],
  allowMethods: ["GET", "POST", "DELETE", "OPTIONS"],
  exposeHeaders: ["Mcp-Session-Id", "Mcp-Protocol-Version"],
}));

app.use("*", async (c, next) => {
  if (c.req.method === "OPTIONS") return next();
  const expected = Deno.env.get("AGENT_TOOLS_BEARER_TOKEN");
  if (!expected || expected.length < 32) {
    return c.json({ error: "MCP authentication secret is not configured." }, 503);
  }
  const header = c.req.header("Authorization") ?? "";
  const supplied = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!supplied || !(await constantTimeEqual(supplied, expected))) {
    return c.json({ error: "Unauthorized" }, 401);
  }
  await next();
});

app.all("*", async (c) => {
  const server = createServer();
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});

Deno.serve(app.fetch);
