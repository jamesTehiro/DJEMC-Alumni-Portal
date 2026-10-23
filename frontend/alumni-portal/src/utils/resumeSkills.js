export const skillCategoryKey = value => {
    const key = String(value ?? "").trim().toLowerCase();
    return key === "uncategorized" ? "" : key;
};

export function getSkillCategories(items = [], categories = []) {
    const names = new Map();
    for (const value of [...(Array.isArray(categories) ? categories : []), ...items.map(item => item.category)]) {
        const key = skillCategoryKey(value);
        if (key && !names.has(key)) names.set(key, String(value).trim());
    }
    return [...names.values()];
}

export function groupResumeSkills(items = [], categories = []) {
    const groups = new Map(getSkillCategories(items, categories).map(category => [skillCategoryKey(category), { category, items: [] }]));
    for (const item of items) {
        const key = skillCategoryKey(item.category);
        if (!groups.has(key)) groups.set(key, { category: "Uncategorized", items: [] });
        groups.get(key).items.push(item);
    }
    return [...groups.values()];
}

export function validateSkillCategory(name, categories = [], previous = "") {
    if (!String(name ?? "").trim()) return "Enter a category name.";
    if (String(name).trim().length > 100) return "Category names must be 100 characters or fewer.";
    const key = skillCategoryKey(name);
    if (!key) return "Uncategorized is reserved for skills without a category.";
    if (categories.some(category => skillCategoryKey(category) === key && skillCategoryKey(category) !== skillCategoryKey(previous))) return "This skill category already exists.";
    return "";
}

export function validateResumeSkills(items = []) {
    const seen = new Set();
    for (const item of items) {
        const name = String(item.skill_name ?? item.name ?? "").trim();
        if (!name) return "Enter a name for every skill.";
        if (name.length > 255) return "Skill names must be 255 characters or fewer.";
        if (String(item.category ?? "").trim().length > 100) return "Category names must be 100 characters or fewer.";
        const key = JSON.stringify([skillCategoryKey(item.category), name.toLowerCase()]);
        if (seen.has(key)) return "This skill already exists in that category.";
        seen.add(key);
    }
    return "";
}
