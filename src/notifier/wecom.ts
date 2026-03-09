interface WecomImagePayload {
  msgtype: "image";
  image: {
    base64: string;
    md5: string;
  };
}

interface WecomResponse {
  errcode: number;
  errmsg: string;
}

interface WecomMarkdownPayload {
  msgtype: "markdown";
  markdown: {
    content: string;
  };
}

export async function sendWecomImage(
  webhook: string,
  base64: string,
  md5: string
): Promise<void> {
  const payload: WecomImagePayload = {
    msgtype: "image",
    image: {
      base64,
      md5
    }
  };

  let response: Response;
  try {
    response = await fetch(webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid URL")) {
      throw new Error(`Invalid URL: ${webhook}`);
    }
    throw error;
  }

  const result = (await response.json()) as WecomResponse;

  if (!response.ok || result.errcode !== 0) {
    throw new Error(
      `send wecom image failed, webhook=${webhook}, status=${response.status}, errcode=${result.errcode}, errmsg=${result.errmsg}`
    );
  }
}

export async function sendWecomMarkdown(webhook: string, content: string): Promise<void> {
  const payload: WecomMarkdownPayload = {
    msgtype: "markdown",
    markdown: {
      content
    }
  };

  let response: Response;
  try {
    response = await fetch(webhook, {
      method: "POST",
      headers: {
        "content-type": "application/json"
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    if (error instanceof Error && error.message.includes("Invalid URL")) {
      throw new Error(`Invalid URL: ${webhook}`);
    }
    throw error;
  }

  const result = (await response.json()) as WecomResponse;
  if (!response.ok || result.errcode !== 0) {
    throw new Error(
      `send wecom markdown failed, webhook=${webhook}, status=${response.status}, errcode=${result.errcode}, errmsg=${result.errmsg}`
    );
  }
}
