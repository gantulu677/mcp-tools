export interface SavePostInput {
  product_id: string;
  product: string;
  headline: string;
  subheadline?: string;
  features: string[];
  composition: string;
  layout: string;
  background: string;
  quality: string;
  prompt: string;
  image_url: string;
  storage_path: string;
}

export interface SavedPost {
  id: string;
  image_url: string;
  status: string;
}

export interface SavePostDependencies {
  getPublicUrl(path: string): string;
  findActiveProduct(id: string): Promise<{ id: string; product: string } | null>;
  storageObjectExists(path: string): Promise<boolean>;
  insertPost(values: Record<string, unknown>): Promise<SavedPost>;
}

export async function savePost(
  input: SavePostInput,
  dependencies: SavePostDependencies,
): Promise<SavedPost> {
  const expectedUrl = dependencies.getPublicUrl(input.storage_path);
  if (
    input.image_url !== expectedUrl ||
    !input.storage_path.startsWith("chatgpt/") ||
    !input.storage_path.endsWith(".png")
  ) {
    throw new Error(
      "Image URL and storage path must refer to a finalized image in the image bucket.",
    );
  }

  const product = await dependencies.findActiveProduct(input.product_id);
  if (!product || product.product !== input.product) {
    throw new Error("Product reference is invalid.");
  }

  if (!await dependencies.storageObjectExists(input.storage_path)) {
    throw new Error("Final image object does not exist in Storage.");
  }

  return await dependencies.insertPost({
    product_id: input.product_id,
    product: input.product,
    headline: input.headline,
    subheadline: input.subheadline ?? null,
    features: input.features,
    composition: input.composition,
    layout: input.layout,
    background: input.background,
    quality: input.quality,
    prompt: input.prompt,
    image_url: input.image_url,
    storage_bucket: "image",
    storage_path: input.storage_path,
    mime_type: "image/png",
    image_width: 1080,
    image_height: 1350,
    status: "completed",
  });
}
