export const PROFILE_PHOTO_MAX_BYTES = 5 * 1024 * 1024;
const PROFILE_PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/gif"]);

export function validateProfilePhoto(file, maxBytes = PROFILE_PHOTO_MAX_BYTES) {
    if (!file) return "Please select an image first.";
    if (!PROFILE_PHOTO_TYPES.has(file.type)) return "Use a PNG, JPG, WebP, or GIF image.";
    if (file.size > maxBytes) return `Profile photos must be ${Math.floor(maxBytes / (1024 * 1024))} MB or smaller.`;
    return "";
}

export function createProfilePhotoFormData(payload, file, fieldName = "avatar_image") {
    const formData = new FormData();
    formData.append("payload", JSON.stringify(payload));
    formData.append(fieldName, file);
    return formData;
}
