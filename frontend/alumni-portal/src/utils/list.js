export const replaceUniqueById = (items) => {
    const seen = new Set();

    return (Array.isArray(items) ? items : []).filter((item) => {
        const key = item?.id ?? item?.threadKey ?? item?.sourceId;
        if (key == null) return true;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
};

export const mergeUniqueById = (currentItems, nextItems, options = {}) => {
    const { prepend = false } = options;
    const merged = prepend
        ? [...(nextItems || []), ...(currentItems || [])]
        : [...(currentItems || []), ...(nextItems || [])];

    return replaceUniqueById(merged);
};
