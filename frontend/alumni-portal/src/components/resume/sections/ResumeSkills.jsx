import React, { useState } from "react";
import { Form, Button, InputGroup } from "react-bootstrap";
import { FaStar, FaPlus, FaTrash } from "react-icons/fa";

export default function ResumeSkills({ items = [], onChange }) {
    const [newSkill, setNewSkill] = useState("");

    const grouped = items.reduce((acc, skill) => {
        const cat = skill.category || "Uncategorized";
        if (!acc[cat]) acc[cat] = [];
        acc[cat].push(skill);
        return acc;
    }, {});

    const addSkill = (category = "Uncategorized") => {
        if (!newSkill.trim()) return;
        onChange([...items, { category, skill_name: newSkill.trim() }]);
        setNewSkill("");
    };

    const updateItem = (index, field, value) => {
        const newItems = [...items];
        newItems[index] = { ...newItems[index], [field]: value };
        onChange(newItems);
    };

    const removeItem = (index) => {
        onChange(items.filter((_, i) => i !== index));
    };

    return (
        <div className="resume-section skills-section">
            <h5>Skills</h5>
            {Object.entries(grouped).map(([category, skills]) => (
                <div key={category} className="skill-category mb-3">
                    <h6>{category}</h6>
                    {skills.map((skill, idx) => {
                        const globalIndex = items.indexOf(skill);
                        return (
                            <div key={globalIndex} className="d-flex gap-2 mb-2 align-items-center">
                                <Form.Control
                                    type="text"
                                    value={skill.skill_name}
                                    onChange={(e) => updateItem(globalIndex, "skill_name", e.target.value)}
                                    placeholder="Skill name"
                                />
                                <Button variant="outline-danger" size="sm" onClick={() => removeItem(globalIndex)}>
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
                        onKeyPress={(e) => e.key === "Enter" && addSkill()}
                    />
                    <Button variant="outline-success" onClick={() => addSkill()}>
                        <FaPlus /> Add Skill
                    </Button>
                </InputGroup>

            </div>
        </div>
    );
}
