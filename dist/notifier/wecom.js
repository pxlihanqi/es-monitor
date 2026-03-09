export async function sendWecomImage(webhook, base64, md5) {
    const payload = {
        msgtype: "image",
        image: {
            base64,
            md5
        }
    };
    let response;
    try {
        response = await fetch(webhook, {
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15_000)
        });
    }
    catch (error) {
        if (error instanceof Error && error.message.includes("Invalid URL")) {
            throw new Error(`Invalid URL: ${webhook}`);
        }
        throw error;
    }
    const result = (await response.json());
    if (!response.ok || result.errcode !== 0) {
        throw new Error(`send wecom image failed, webhook=${webhook}, status=${response.status}, errcode=${result.errcode}, errmsg=${result.errmsg}`);
    }
}
export async function sendWecomMarkdown(webhook, content) {
    const payload = {
        msgtype: "markdown",
        markdown: {
            content
        }
    };
    let response;
    try {
        response = await fetch(webhook, {
            method: "POST",
            headers: {
                "content-type": "application/json"
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(15_000)
        });
    }
    catch (error) {
        if (error instanceof Error && error.message.includes("Invalid URL")) {
            throw new Error(`Invalid URL: ${webhook}`);
        }
        throw error;
    }
    const result = (await response.json());
    if (!response.ok || result.errcode !== 0) {
        throw new Error(`send wecom markdown failed, webhook=${webhook}, status=${response.status}, errcode=${result.errcode}, errmsg=${result.errmsg}`);
    }
}
