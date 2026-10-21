import React, { useEffect, useState } from "react";
import { findProgram, programs } from "../utils/academicPrograms";

export default function AcademicProgramFields({ course = "", major = "", onChange, allowLegacy = false, allowMissingMajor = allowLegacy, className = "" }) {
    const configured = findProgram(course);
    const [other, setOther] = useState(Boolean(course && !configured));
    useEffect(() => { if (configured) setOther(false); else if (course) setOther(true); }, [course, configured]);
    const selected = configured?.value || (other ? "__other" : "");
    const field = (label, input) => <label className={`field d-block mb-3 ${className}`}><span className="d-block mb-1">{label}</span>{input}</label>;
    return <>
        {field("Program", <select className="form-select" name="course" aria-label="Program" required value={selected} onChange={e => {
            const value = e.target.value;
            setOther(value === "__other");
            onChange({ course: value === "__other" ? "" : value, major: "" });
        }}><option value="">Select your program</option>{programs.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}<option value="__other">Other (Enter your program)</option></select>)}
        {other && !configured && field("Enter Your Previous Program", <input className="form-control" name="previous_program" aria-label="Enter Your Previous Program" required maxLength={255} value={course} onChange={e => { const next = e.target.value; const program = findProgram(next); onChange({ course: next, major: program && !program.majors.includes(major) ? "" : major }); }} />)}
        {configured?.majors.length > 0 && field("Major / Specialization", <select className="form-select" name="major" aria-label="Major / Specialization" required={!allowMissingMajor} value={major || ""} onChange={e => onChange({ course, major: e.target.value })}><option value="">{allowMissingMajor ? "Not recorded — choose if known" : "Select your major"}</option>{major && !configured.majors.includes(major) && allowLegacy && <option value={major}>{major} (existing)</option>}{configured.majors.map(m => <option key={m} value={m}>{m}</option>)}</select>)}
        {other && !configured && field("Major / Specialization (optional)", <input className="form-control" name="major" aria-label="Major / Specialization" maxLength={255} value={major || ""} onChange={e => onChange({ course, major: e.target.value })} />)}
    </>;
}
