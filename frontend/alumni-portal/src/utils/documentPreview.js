const imageTypes = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

// Inspect original bytes: stale image metadata must never turn a PDF into an image.
export async function prepareDocumentBlob(blob) {
    const bytes = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
    const ascii = (start, end) => String.fromCharCode(...bytes.slice(start, end));
    let type = "application/octet-stream";
    if (ascii(0, 5) === "%PDF-") type = "application/pdf";
    else if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, index) => bytes[index] === byte)) type = "image/png";
    else if (bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255) type = "image/jpeg";
    else if (["GIF87a", "GIF89a"].includes(ascii(0, 6))) type = "image/gif";
    else if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP") type = "image/webp";
    else if (ascii(0, 4) === "PK\u0003\u0004") type = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    else if ([208, 207, 17, 224, 161, 177, 26, 225].every((byte, index) => bytes[index] === byte)) type = "application/msword";
    return { blob: blob.type === type ? blob : new Blob([blob], { type }), type, image: imageTypes.has(type) };
}
