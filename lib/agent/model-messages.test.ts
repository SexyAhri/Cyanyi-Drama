import { describe, expect, it } from "vitest";

import { normalizeMessages } from "./model-messages";
import type { AgentMessage } from "./types";

describe("normalizeMessages", () => {
  it("keeps the latest historical image for image follow-up questions", () => {
    const messages: AgentMessage[] = [
      createUserMessageWithImage({
        content: "Analyze this photo style",
        id: "msg_1",
        imageUrl: "data:image/png;base64,photo",
      }),
      {
        id: "msg_2",
        role: "assistant",
        content: "It is a commercial lookbook style.",
      },
      {
        id: "msg_3",
        role: "user",
        content: "Can you optimize it?",
      },
    ];

    const normalized = normalizeMessages(messages, messages.at(-1)?.content, {
      mode: "chat",
    });

    expect(normalized[0]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "Analyze this photo style",
        },
        {
          type: "image",
          image: "data:image/png;base64,photo",
          mediaType: "image/png",
        },
      ],
    });
    expect(normalized[2]).toEqual({
      role: "user",
      content: "Can you optimize it?",
    });
  });

  it("uses current composer images for the latest submitted message", () => {
    const messages: AgentMessage[] = [
      {
        id: "msg_1",
        role: "user",
        content: "Explain this image",
      },
    ];

    const normalized = normalizeMessages(messages, "Explain this image", {
      mode: "chat",
      referenceImages: [
        {
          url: "data:image/jpeg;base64,current",
          mimeType: "image/jpeg",
        },
      ],
    });

    expect(normalized[0]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "Explain this image",
        },
        {
          type: "image",
          image: "data:image/jpeg;base64,current",
          mediaType: "image/jpeg",
        },
      ],
    });
  });

  it("appends submitted content when request messages lag behind local state", () => {
    const messages: AgentMessage[] = [
      createUserMessageWithImage({
        content: "Explain the code in this screenshot",
        id: "msg_1",
        imageUrl: "data:image/png;base64,old-code",
      }),
      {
        id: "msg_2",
        role: "assistant",
        content: "The code persists chat state into IndexedDB.",
      },
    ];

    const normalized = normalizeMessages(messages, "Analyze this photo style", {
      mode: "chat",
      referenceImages: [
        {
          url: "data:image/png;base64,new-person",
          mimeType: "image/png",
        },
      ],
    });

    expect(normalized.at(-1)).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "Analyze this photo style",
        },
        {
          type: "image",
          image: "data:image/png;base64,new-person",
          mediaType: "image/png",
        },
      ],
    });
    expect(normalized[0]).toEqual({
      role: "user",
      content: "Explain the code in this screenshot",
    });
  });

  it("does not send older images when the latest message attaches a new image", () => {
    const messages: AgentMessage[] = [
      createUserMessageWithImage({
        content: "Explain the code in this screenshot",
        id: "msg_1",
        imageUrl: "data:image/png;base64,old-code",
      }),
      {
        id: "msg_2",
        role: "assistant",
        content: "The code persists chat state into IndexedDB.",
      },
      {
        id: "msg_3",
        role: "user",
        content: "Analyze this photo style",
      },
    ];

    const normalized = normalizeMessages(messages, "Analyze this photo style", {
      mode: "chat",
      referenceImages: [
        {
          url: "data:image/png;base64,new-person",
          mimeType: "image/png",
        },
      ],
    });

    expect(normalized[0]).toEqual({
      role: "user",
      content: "Explain the code in this screenshot",
    });
    expect(normalized[2]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "Analyze this photo style",
        },
        {
          type: "image",
          image: "data:image/png;base64,new-person",
          mediaType: "image/png",
        },
      ],
    });
  });

  it("uses only the newest historical image when there are multiple image turns", () => {
    const messages: AgentMessage[] = [
      createUserMessageWithImage({
        content: "Explain this code screenshot",
        id: "msg_1",
        imageUrl: "data:image/png;base64,old-code",
      }),
      {
        id: "msg_2",
        role: "assistant",
        content: "The code saves state.",
      },
      createUserMessageWithImage({
        content: "Analyze this photo style",
        id: "msg_3",
        imageUrl: "data:image/png;base64,new-person",
      }),
      {
        id: "msg_4",
        role: "assistant",
        content: "It is a lookbook style.",
      },
      {
        id: "msg_5",
        role: "user",
        content: "Can you optimize it?",
      },
    ];

    const normalized = normalizeMessages(messages, messages.at(-1)?.content, {
      mode: "chat",
    });

    expect(normalized[0]).toEqual({
      role: "user",
      content: "Explain this code screenshot",
    });
    expect(normalized[2]).toEqual({
      role: "user",
      content: [
        {
          type: "text",
          text: "Analyze this photo style",
        },
        {
          type: "image",
          image: "data:image/png;base64,new-person",
          mediaType: "image/png",
        },
      ],
    });
    expect(normalized[4]).toEqual({
      role: "user",
      content: "Can you optimize it?",
    });
  });
});

function createUserMessageWithImage({
  content,
  id,
  imageUrl,
}: {
  content: string;
  id: string;
  imageUrl: string;
}): AgentMessage {
  return {
    id,
    role: "user",
    content,
    metadata: {
      composer: {
        mode: "chat",
        referenceImages: [
          {
            url: imageUrl,
            mimeType: "image/png",
          },
        ],
      },
    },
  };
}
