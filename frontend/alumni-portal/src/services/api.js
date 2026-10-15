import axios from "axios";

// Prefer explicit env; otherwise use the same origin as the loaded page (works for ngrok/public deploys)
const inferredBase =
    (typeof window !== "undefined" ? `${window.location.origin}/api` : "http://localhost:5000/api");

export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || inferredBase;

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json"
    }
});

apiClient.interceptors.request.use((config) => {
    const token = localStorage.getItem("token");
    if (token) {
        config.headers.Authorization = `Bearer ${token}`;
    } else {
        delete config.headers.Authorization;
    }

    // Let the browser set multipart boundaries when uploading files
    if (config.data instanceof FormData) {
        delete config.headers["Content-Type"];
    }

    return config;
});

apiClient.interceptors.response.use(
    (response) => response.data,
    (error) => {
        const message = error.response?.data?.msg || error.message || "Request failed";
        const failure = new Error(message);
        failure.status = error.response?.status;
        failure.field = error.response?.data?.field;
        return Promise.reject(failure);
    }
);

const ensureAuth = () => {
    if (!localStorage.getItem("token")) {
        throw new Error("You need to log in first.");
    }
};

const getServerOrigin = () => API_BASE_URL.replace(/\/api$/, "");

export const resolveFileUrl = (filePath) => {
    if (!filePath) return "";
    if (filePath.startsWith("data:") || filePath.startsWith("blob:") || /^https?:\/\//i.test(filePath)) {
        return filePath;
    }

    const normalizedPath = String(filePath).replace(/\\/g, "/");
    const serverOrigin = getServerOrigin();

    if (normalizedPath.startsWith("/")) {
        return `${serverOrigin}${normalizedPath}`;
    }

    if (normalizedPath.startsWith("uploads/")) {
        return `${serverOrigin}/${normalizedPath}`;
    }

    if (normalizedPath.startsWith("api/")) {
        return `${serverOrigin}/${normalizedPath}`;
    }

    if (normalizedPath.includes("/uploads/")) {
        const uploadsMatch = normalizedPath.match(/\/uploads\/(.+)$/);
        if (uploadsMatch) {
            return `${serverOrigin}/api/files/${uploadsMatch[1]}`;
        }
    }

    return `${serverOrigin}/${normalizedPath.replace(/^\.?\//, "")}`;
};

export const fetchFile = async (path, auth = false) => {
    const url = resolveFileUrl(path);
    const headers = {};
    if (auth) {
        ensureAuth();
        const token = localStorage.getItem("token");
        if (token) {
            headers.Authorization = `Bearer ${token}`;
        }
    }

    const response = await fetch(url, { headers });
    if (!response.ok) {
        const text = await response.text();
        let message = text;
        try {
            const payload = JSON.parse(text);
            message = payload?.msg || payload?.message || text;
        } catch {
            // Keep a plain-text server response when it is not JSON.
        }
        const statusMessage = {
            401: "Your session has expired. Please sign in again.",
            403: "You are not allowed to access this document.",
            404: "The uploaded document could not be found."
        }[response.status];
        throw new Error(statusMessage || message || `Unable to fetch protected file (HTTP ${response.status}).`);
    }

    return response.blob();
};

export const api = {
    get: (path, auth = false, config = {}) => {
        if (auth) ensureAuth();
        return apiClient.get(path, config);
    },
    post: (path, payload, auth = false, config = {}) => {
        if (auth) ensureAuth();
        return apiClient.post(path, payload, config);
    },
    put: (path, payload, auth = false, config = {}) => {
        if (auth) ensureAuth();
        return apiClient.put(path, payload, config);
    },
    delete: (path, auth = false, config = {}) => {
        if (auth) ensureAuth();
        return apiClient.delete(path, config);
    }
};

