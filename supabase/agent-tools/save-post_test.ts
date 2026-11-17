import { savePost, type SavePostDependencies, type SavePostInput } from "./save-post.ts";

const validInput: SavePostInput = {
  product_id: "11111111-1111-4111-8111-111111111111",
  product: "Apple iPhone 17 Pro",
  headline: "Pro in Every Detail",
  subheadline: "Built for creators",
  features: ["A19 Pro"],
  composition: "Hero product",
  layout: "Centered",
  background: "Dark studio",
  quality: "Premium",
  prompt: "Create a premium product poster",
  image_url: "https://example.supabase.co/storage/v1/object/public/image/chatgpt/test.png",
  storage_path: "chatgpt/test.png",
};

function dependencies(overrides: Partial<SavePostDependencies> = {}): SavePostDependencies {
  return {
    getPublicUrl: (path) =>
      "https://example.supabase.co/storage/v1/object/public/image/" + path,
    findActiveProduct: async (id) =>
      id === validInput.product_id
        ? { id, product: validInput.product }
        : null,
    storageObjectExists: async () => true,
    insertPost: async () => ({
      id: "22222222-2222-4222-8222-222222222222",
      image_url: validInput.image_url,
      status: "completed",
    }),
    ...overrides,
  };
}

async function rejectsWith(
  action: () => Promise<unknown>,
  expectedMessage: string,
): Promise<void> {
  try {
    await action();
  } catch (error) {
    if (error instanceof Error && error.message === expectedMessage) return;
    throw new Error("Unexpected rejection: " + String(error));
  }
  throw new Error("Expected rejection: " + expectedMessage);
}

Deno.test("savePost persists a valid product and finalized image", async () => {
  let inserted: Record<string, unknown> | undefined;
  const result = await savePost(validInput, dependencies({
    insertPost: async (values) => {
      inserted = values;
      return {
        id: "22222222-2222-4222-8222-222222222222",
        image_url: validInput.image_url,
        status: "completed",
      };
    },
  }));

  if (result.status !== "completed") throw new Error("Expected completed status.");
  if (inserted?.storage_bucket !== "image") throw new Error("Expected image bucket.");
  if (inserted?.storage_path !== validInput.storage_path) throw new Error("Unexpected storage path.");
  if (inserted?.image_width !== 1080 || inserted?.image_height !== 1350) {
    throw new Error("Expected 1080x1350 image metadata.");
  }
});

Deno.test("savePost rejects an unknown or inactive product", async () => {
  await rejectsWith(
    () => savePost(validInput, dependencies({ findActiveProduct: async () => null })),
    "Product reference is invalid.",
  );
});

Deno.test("savePost rejects a product name that does not match its ID", async () => {
  await rejectsWith(
    () => savePost({ ...validInput, product: "Different product" }, dependencies()),
    "Product reference is invalid.",
  );
});

Deno.test("savePost rejects a mismatched public image URL", async () => {
  await rejectsWith(
    () => savePost({ ...validInput, image_url: "https://attacker.example/file.png" }, dependencies()),
    "Image URL and storage path must refer to a finalized image in the image bucket.",
  );
});

Deno.test("savePost rejects paths outside the finalized image namespace", async () => {
  await rejectsWith(
    () => savePost({ ...validInput, storage_path: "other/test.png" }, dependencies()),
    "Image URL and storage path must refer to a finalized image in the image bucket.",
  );
});

Deno.test("savePost rejects a missing Storage object", async () => {
  await rejectsWith(
    () => savePost(validInput, dependencies({ storageObjectExists: async () => false })),
    "Final image object does not exist in Storage.",
  );
});

Deno.test("savePost propagates database insert failures", async () => {
  await rejectsWith(
    () => savePost(validInput, dependencies({
      insertPost: async () => { throw new Error("database unavailable"); },
    })),
    "database unavailable",
  );
});
