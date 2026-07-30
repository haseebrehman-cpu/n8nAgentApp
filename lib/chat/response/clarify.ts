/**
 * Dynamic clarification replies from live collection children — never hardcoded
 * category menus.
 */

const STORE_NAME = process.env.NEXT_PUBLIC_STORE_NAME || "our store";

export function buildDynamicClarificationReply(input: {
  topicLabel: string;
  options: string[];
}): string {
  const topic = input.topicLabel.trim() || "that area";
  const options = input.options.filter(Boolean).slice(0, 8);

  if (options.length === 0) {
    return `### Let's narrow it down

Happy to help you find the right gear from ${STORE_NAME}.

### Next step

What type of product are you looking for within **${topic}**?`;
  }

  const bullets = options.map((o) => `- ${o}`).join("\n");

  return `### ${topic}

That's a great place to start — there's quite a few options.

### Are you looking for:

${bullets}

### Next step

Which of those should we look at first?`;
}
