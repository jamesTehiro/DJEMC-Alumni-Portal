import React, { useState } from "react";
import { Form, Button, InputGroup } from "react-bootstrap";
import { FaStar, FaPlus, FaTrash } from "react-icons/fa";
import { getSkillCategories, groupResumeSkills, skillCategoryKey, validateResumeSkills, validateSkillCategory } from "../../../utils/resumeSkills";

export default function ResumeSkills({ items = [], categories = [], onChange }) {
    const [newSkill, setNewSkill] = useState("");
    const [selectedCategory, setSelectedCategory] = useState("");
    const [newCategory, setNewCategory] = useState("");
    const [renaming, setRenaming] = useState(null);
    const [error, setError] = useState("");
    const categoryNames = getSkillCategories(items, categories);
    const activeCategory = categoryNames.find(name => skillCategoryKey(name) === skillCategoryKey(selectedCategory)) || "";

    const grouped = groupResumeSkills(items, categoryNames);

    const addSkill = () => {
        const next = [...items, { category: activeCategory || null, skill_name: newSkill.trim() }];
        const failure = validateResumeSkills(next);
        setError(failure);
        if (failure) return;
        onChange(next, categoryNames);
        setNewSkill("");
    };

    const addCategory = () => {
        const failure = validateSkillCategory(newCategory, categoryNames);
        setError(failure);
        if (failure) return;
        const name = newCategory.trim();
        onChange(items, [...categoryNames, name]);
        setSelectedCategory(name);
        setNewCategory("");
    };

    const renameCategory = () => {
        const failure = validateSkillCategory(renaming.value, categoryNames, renaming.category);
        setError(failure);
        if (failure) return;
        const name = renaming.value.trim();
        const key = skillCategoryKey(renaming.category);
        onChange(items.map(item => skillCategoryKey(item.category) === key ? { ...item, category: name } : item), categoryNames.map(category => skillCategoryKey(category) === key ? name : category));
        if (skillCategoryKey(activeCategory) === key) setSelectedCategory(name);
        setRenaming(null);
    };

    const removeCategory = category => {
        const key = skillCategoryKey(category);
        const next = items.map(item => skillCategoryKey(item.category) === key ? { ...item, category: null } : item);
        const failure = validateResumeSkills(next);
        setError(failure);
        if (failure) return;
        onChange(next, categoryNames.filter(name => skillCategoryKey(name) !== key));
        if (skillCategoryKey(activeCategory) === key) setSelectedCategory("");
        setRenaming(null);
        setError("");
    };

    const updateItem = (index, field, value) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };
        if (field === "category") {
            const failure = validateResumeSkills(newItems);
            setError(failure);
            if (failure) return;
        } else setError("");
        onChange(newItems, categoryNames);
    };

    const removeItem = (index) => {
        onChange(items.filter((_, i) => i !== index), categoryNames);
        setError("");
    };

    return (
        <div className="resume-section skills-section">
            <h5>Skills</h5>
            {(error || validateResumeSkills(items)) && <p className="text-danger" role="alert">{error || validateResumeSkills(items)}</p>}
            <Form.Group className="mb-2" controlId="resume-skill-category">
                <Form.Label>Category for new skills</Form.Label>
                <Form.Select value={activeCategory} onChange={event => { setSelectedCategory(event.target.value); setError(""); }}>
                    <option value="">Uncategorized</option>
                    {categoryNames.map(category => <option key={category} value={category}>{category}</option>)}
                </Form.Select>
            </Form.Group>
            <InputGroup className="mb-3">
                <Form.Control placeholder="New category name" aria-label="New skill category" maxLength={100} value={newCategory} onChange={event => setNewCategory(event.target.value)} onKeyDown={event => { if (event.key === "Enter") { event.preventDefault(); addCategory(); } }} />
                <Button variant="outline-success" onClick={addCategory}><FaPlus /> Add Category</Button>
            </InputGroup>
            {grouped.map(({ category, items: skills }) => (
                <div key={category} className="skill-category mb-3">
                    <div className="d-flex flex-wrap gap-2 align-items-center mb-2">
                        <h6 className="mb-0">{category}</h6>
                        {skillCategoryKey(category) && <>
                            <Button variant="outline-secondary" size="sm" aria-label={`Rename ${category} category`} onClick={() => { setRenaming({ category, value: category }); setError(""); }}>Rename</Button>
                            <Button variant="outline-danger" size="sm" aria-label={`Remove ${category} category`} title="Move these skills to Uncategorized" onClick={() => removeCategory(category)}>Remove category</Button>
                        </>}
                    </div>
                    {renaming?.category === category && <InputGroup className="mb-2">
                        <Form.Control aria-label="Rename skill category" value={renaming.value} maxLength={100} onChange={event => setRenaming({ ...renaming, value: event.target.value })} />
                        <Button variant="outline-success" onClick={renameCategory}>Save Category</Button>
                        <Button variant="outline-secondary" onClick={() => setRenaming(null)}>Cancel</Button>
                    </InputGroup>}
                    {!skills.length && <small className="text-muted">No skills yet.</small>}
                    {skills.map((skill) => {
                        const globalIndex = items.indexOf(skill);
                        return (
                            <div key={globalIndex} className="resume-skill-row d-flex flex-wrap gap-2 mb-2 align-items-center">
                                <Form.Control
                                    type="text"
                                    value={skill.skill_name}
                                    onChange={(e) => updateItem(globalIndex, "skill_name", e.target.value)}
                                    placeholder="Skill name"
                                    aria-label={`Skill ${globalIndex + 1} name`}
                                    maxLength={255}
                                />
                                <Form.Select className="resume-skill-category-select" aria-label={`Category for skill ${globalIndex + 1}`} value={categoryNames.find(name => skillCategoryKey(name) === skillCategoryKey(skill.category)) || ""} onChange={event => updateItem(globalIndex, "category", event.target.value || null)}>
                                    <option value="">Uncategorized</option>
                                    {categoryNames.map(name => <option key={name} value={name}>{name}</option>)}
                                </Form.Select>
                                <Button variant="outline-danger" size="sm" aria-label={`Remove skill ${globalIndex + 1}`} onClick={() => removeItem(globalIndex)}>
                                    <FaTrash />
                                </Button>
                            </div>
                        );
                    })}
                </div>
            ))}

            <div className="add-skill-form">
                <InputGroup className="mb-2">
                    <Form.Control
                        placeholder="New skill name"
                        value={newSkill}
                        onChange={(e) => setNewSkill(e.target.value)}
                        maxLength={255}
                        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); addSkill(); } }}
                    />
                    <Button variant="outline-success" onClick={() => addSkill()}>
                        <FaPlus /> Add Skill
                    </Button>
                </InputGroup>

            </div>
        </div>
    );
}
