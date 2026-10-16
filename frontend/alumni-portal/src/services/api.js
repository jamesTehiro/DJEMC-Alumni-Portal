
import axios from "axios";

const DEFAULT_PRODUCTION_API_URL =
    "https://djemc-alumni-backend.onrender.com/api";

const DEFAULT_LOCAL_API_URL = "http://localhost:5000/api";

const normalizeBaseUrl = (url) => String(url || "").trim().replace(/\/+$/, "");

const getApiBaseUrl = () => {
    const configuredUrl = normalizeBaseUrl(
        import.meta.env.VITE_API_BASE_URL
    );

    // Production must use the configured Render backend.
    if (import.meta.env.PROD) {
        return configuredUrl || DEFAULT_PRODUCTION_API_URL;
    }

    // Local development can use .env or the local backend.
    if (configuredUrl) {
        return configuredUrl;
    }

    return DEFAULT_LOCAL_API_URL;
};

export const API_BASE_URL = getApiBaseUrl();

const apiClient = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        "Content-Type": "application/json",
    },
});

const isValidToken = (token) =>
    typeof token === "string" &&
    token.trim().length > 0 &&
    !["undefined", "null"].includes(token.trim().toLowerCase());

const getAuthToken = () => {
    try {
        if (typeof localStorage === "undefined") {
            return null;
        }

        const token = localStorage.getItem("token");
        return isValidToken(token) ? token.trim() : null;
    } catch {
        return null;
    }
};

const ensureAuth = () => {
    if (!getAuthToken()) {
        throw new Error("You need to log in first.");
    }
};

apiClient.interceptors.request.use(
    (config) => {
        const token = getAuthToken();

        // Never send an invalid or missing token.
        config.headers = config.headers || {};

        if (token) {
            config.headers.Authorization = `Bearer ${token}`;
        } else {
            delete config.headers.Authorization;
            delete config.headers.authorization;
        }

        // Allow the browser to set multipart boundaries for file uploads.
        if (
            typeof FormData !== "undefined" &&
            config.data instanceof FormData
        ) {
            if (typeof config.headers.delete === "function") {
                config.headers.delete("Content-Type");
            } else {
                delete config.headers["Content-Type"];
                delete config.headers["content-type"];
            }
        }

        return config;
    },
    (error) => Promise.reject(error)
);

apiClient.interceptors.response.use(
    (response) => {
        const requestUrl = String(response.config?.url || "").replace(
            /\/+$/,
            ""
        );

        const isLoginRequest =
            /(?:^|\/)auth\/login(?:\?|$)/i.test(requestUrl);

        if (isLoginRequest) {
            const responseType = String(
                response.headers?.["content-type"] || ""
            ).toLowerCase();

            if (!responseType.includes("application/json")) {
                throw new Error(
                    "The login API returned a non-JSON response. Check the backend URL and deployment configuration."
                );
            }

            if (
                !isValidToken(response.data?.token) ||
                !response.data?.user
            ) {
                throw new Error(
                    "The login API returned an invalid response. Check the API connection and backend login response."
                );
            }
        }

        return response.data;
    },
    (error) => {
        const responseData = error.response?.data;

        let message =
            responseData?.msg ||
            responseData?.message ||
            error.message ||
            "Request failed";

        // Detect a frontend HTML fallback instead of an API response.
        const contentType = String(
            error.response?.headers?.["content-type"] || ""
        ).toLowerCase();

        if (contentType.includes("text/html")) {
            message =
                "The API returned HTML instead of JSON. Verify VITE_API_BASE_URL and the backend deployment.";
        }

        const failure = new Error(message);
        failure.status = error.response?.status;
        failure.field = responseData?.field;

        return Promise.reject(failure);
    }
);

const getServerOrigin = () => {
    return API_BASE_URL.replace(/\/api\/?$/i, "");
};

export const resolveFileUrl = (filePath) => {
    if (!filePath) {
        return "";
    }

    const path = String(filePath).trim();

    if (/^(?:data:|blob:|https?:\/\/)/i.test(path)) {
        return path;
    }

    const normalizedPath = path.replace(/\\/g, "/");
    const serverOrigin = getServerOrigin();

    if (normalizedPath.startsWith("/")) {
        return `${serverOrigin}${normalizedPath}`;
    }

    if (normalizedPath.startsWith("api/")) {
        return `${serverOrigin}/${normalizedPath}`;
    }

    if (normalizedPath.startsWith("uploads/")) {
        return `${serverOrigin}/${normalizedPath}`;
    }

    if (normalizedPath.includes("/uploads/")) {
        const uploadsMatch = normalizedPath.match(/\/uploads\/(.+)$/i);

        if (uploadsMatch) {
            return `${serverOrigin}/api/files/${uploadsMatch[1]}`;
        }
    }

    return `${serverOrigin}/${normalizedPath.replace(/^\.?\//, "")}`;
};

export const fetchFile = async (path, auth = false) => {
    const url = resolveFileUrl(path);

    if (!url) {
        throw new Error("No file path was provided.");
    }

    const headers = {};

    if (auth) {
        ensureAuth();

        const token = getAuthToken();

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
            // Preserve the response text if it is not JSON.
        }

        const statusMessage = {
            401: "Your session has expired. Please sign in again.",
            403: "You are not allowed to access this document.",
            404: "The uploaded document could not be found.",
        }[response.status];

        throw new Error(
            statusMessage ||
            message ||
            `Unable to fetch file (HTTP ${response.status}).`
        );
    }

    return response.blob();
};

export const api = {
    get: (path, auth = false, config = {}) => {
        if (auth) {
            ensureAuth();
        }

        return apiClient.get(path, config);
    },

    post: (path, payload, auth = false, config = {}) => {
        if (auth) {
            ensureAuth();
        }

        return apiClient.post(path, payload, config);
    },

    put: (path, payload, auth = false, config = {}) => {
        if (auth) {
            ensureAuth();
        }

        return apiClient.put(path, payload, config);
    },

    delete: (path, auth = false, config = {}) => {
        if (auth) {
            ensureAuth();
        }

        return apiClient.delete(path, config);
    },
};
