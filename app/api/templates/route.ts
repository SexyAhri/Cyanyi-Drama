import type { AgentComposerTemplate } from "@/components/agent/composer";

export const dynamic = "force-dynamic";

type Prompt = {
  category: string;
  coverUrl: string;
  githubUrl: string;
  id: string;
  prompt: string;
  tags: string[];
  title: string;
};

const awesomeGptImageRawBase =
  "https://raw.githubusercontent.com/ZeroLu/awesome-gpt-image/main";
const awesomeGpt4oImagePromptsBase =
  "https://raw.githubusercontent.com/ImgEdify/Awesome-GPT4o-Image-Prompts/main";
const cacheTtlMs = 1000 * 60 * 60;

let memoryCache: { items: AgentComposerTemplate[]; fetchedAt: number } | null =
  null;
let loadingTemplates: Promise<AgentComposerTemplate[]> | null = null;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(40, Math.max(1, Number(url.searchParams.get("limit")) || 12));
  const items = await getTemplates();

  return Response.json({
    items: items.slice(0, limit),
    total: items.length,
  });
}

async function getTemplates() {
  if (memoryCache && Date.now() - memoryCache.fetchedAt < cacheTtlMs) {
    return memoryCache.items;
  }

  if (loadingTemplates) {
    return loadingTemplates;
  }

  loadingTemplates = loadTemplates().finally(() => {
    loadingTemplates = null;
  });

  return loadingTemplates;
}

async function loadTemplates() {
  const settled = await Promise.allSettled([
    buildAwesomeGptImagePrompts(),
    buildAwesomeGpt4oImagePrompts(),
  ]);
  const prompts = settled.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const templates = prompts.map(toTemplate).filter(hasTemplateImage);

  memoryCache = {
    items: templates,
    fetchedAt: Date.now(),
  };

  return templates;
}

async function buildAwesomeGptImagePrompts() {
  const markdown = await fetchText(awesomeGptImageRawBase, "README.zh-CN.md");
  const items: Prompt[] = [];

  for (const section of splitBeforeHeading(markdown, "## ")) {
    const tags = tagsFromHeading(firstMatch(section, /^##\s+(.+)$/m));

    for (const block of splitBeforeHeading(section, "### ")) {
      const title = firstMatch(block, /^###\s+(.+)$/m)
        .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
        .trim();
      const prompt = firstMatch(
        block,
        /\*\*提示词:\*\*\s*\r?\n\s*```[\w-]*\r?\n([\s\S]*?)\r?\n```/,
      ).trim();

      if (!title || !prompt) {
        continue;
      }

      const images = extractMarkdownImages(awesomeGptImageRawBase, block);

      items.push({
        id: `awesome-gpt-image-${String(items.length + 1).padStart(4, "0")}`,
        title,
        coverUrl: images[0] || "",
        prompt,
        tags,
        category: "awesome-gpt-image",
        githubUrl: "https://github.com/ZeroLu/awesome-gpt-image",
      });
    }
  }

  return items;
}

async function buildAwesomeGpt4oImagePrompts() {
  const markdown = await fetchText(awesomeGpt4oImagePromptsBase, "README.zh-CN.md");
  const items: Prompt[] = [];

  for (const block of splitBeforeHeading(markdown, "### ")) {
    const title = firstMatch(block, /^###\s+(.+)$/m).trim();
    const prompt = firstMatch(
      block,
      /- \*\*提示词文本：\*\*\s*`([\s\S]*?)`/,
    ).trim();

    if (!title || !prompt) {
      continue;
    }

    const images = extractMarkdownImages(awesomeGpt4oImagePromptsBase, block);

    items.push({
      id: `awesome-gpt4o-image-prompts-${String(items.length + 1).padStart(4, "0")}`,
      title,
      coverUrl: images[0] || "",
      prompt,
      tags: ["gpt4o"],
      category: "awesome-gpt4o-image-prompts",
      githubUrl: "https://github.com/ImgEdify/Awesome-GPT4o-Image-Prompts",
    });
  }

  return items;
}

function toTemplate(prompt: Prompt): AgentComposerTemplate {
  return {
    category: prompt.category,
    description: prompt.tags.slice(0, 2).join(" / ") || prompt.category,
    id: prompt.id,
    imageUrl: createTemplateImageProxyUrl(prompt.coverUrl),
    originalImageUrl: prompt.coverUrl,
    prompt: prompt.prompt,
    promptPreview: createPromptPreview(prompt),
    ratio: inferRatio(prompt.tags),
    sourceUrl: prompt.githubUrl,
    style: inferStyle(prompt.tags),
    tags: prompt.tags,
    title: prompt.title,
  };
}

function createPromptPreview(prompt: Prompt) {
  const title = prompt.title.replace(/\s+/g, " ").trim();
  const tags = prompt.tags.slice(0, 2).join("、");
  const base = title ? `参考「${title}」模板，生成一张图片` : "基于所选模板生成一张图片";
  const suffix = tags ? `，风格方向：${tags}` : "";

  return `${base}${suffix}。`;
}

function createTemplateImageProxyUrl(imageUrl: string) {
  if (!imageUrl) {
    return "";
  }

  return `/api/template-image?url=${encodeURIComponent(imageUrl)}`;
}

function hasTemplateImage(template: AgentComposerTemplate) {
  return Boolean(template.imageUrl);
}

async function fetchText(baseUrl: string, file: string) {
  const response = await fetch(`${baseUrl}/${file}`, { cache: "no-store" });

  if (!response.ok) {
    throw new Error(`${file} fetch failed`);
  }

  return response.text();
}

function splitBeforeHeading(markdown: string, prefix: string) {
  const blocks: string[] = [];
  let current: string[] = [];

  for (const line of markdown.split("\n")) {
    if (line.startsWith(prefix) && current.length) {
      blocks.push(current.join("\n"));
      current = [];
    }

    current.push(line);
  }

  blocks.push(current.join("\n"));
  return blocks;
}

function firstMatch(value: string, pattern: RegExp) {
  return pattern.exec(value)?.[1] || "";
}

function extractMarkdownImages(baseUrl: string, markdown: string) {
  return Array.from(markdown.matchAll(/!\[[^\]]*]\(([^)]+)\)/g), (match) =>
    absoluteImage(baseUrl, match[1]),
  ).filter(Boolean);
}

function absoluteImage(baseUrl: string, image: string) {
  if (!image) {
    return "";
  }

  if (/^https?:\/\//i.test(image)) {
    return image;
  }

  return `${baseUrl}/${image.replace(/^\.?\//, "")}`;
}

function tagsFromHeading(heading: string) {
  return heading
    .replace(/[^\p{L}\p{N}/&、与 ]/gu, "")
    .split(/\s*(?:\/|&|、|与)\s*/)
    .map((tag) => tag.trim().toLowerCase())
    .filter(Boolean);
}

function inferRatio(tags: string[]) {
  const joined = tags.join(" ");

  if (/poster|海报|portrait|人像/i.test(joined)) {
    return "3:4";
  }

  if (/ui|banner|横/i.test(joined)) {
    return "16:9";
  }

  return "1:1";
}

function inferStyle(tags: string[]) {
  const joined = tags.join(" ");

  if (/photo|portrait|人像|摄影/i.test(joined)) {
    return "photo";
  }

  if (/product|ecommerce|商品/i.test(joined)) {
    return "product";
  }

  return "illustration";
}
