import { useCallback, useRef, useState } from "react";

export function getRegistrationIssue({ requiredIssue, password, confirmPassword, consent, employer = false }) {
    if (requiredIssue) return requiredIssue;
    if (!password) return { field: "password", title: "Password Required", message: "Please enter your password." };
    if (!confirmPassword) return { field: "confirmPassword", title: "Confirm Password Required", message: "Please confirm your password." };
    if (password !== confirmPassword) return {
        field: "confirmPassword", title: "Passwords Do Not Match",
        message: "Your password and confirm password do not match. Please check and try again."
    };
    if (!consent) return {
        field: "consent", title: employer ? "Data Privacy Consent Required" : "Privacy Consent Required",
        message: employer
            ? "Please review and accept the Data Privacy Consent before creating your employer account."
            : "Please review and accept the Privacy Consent before creating your account."
    };
    return null;
}

export default function useRegistrationValidation() {
    const [notice, setNotice] = useState(null);
    const sequence = useRef(0);
    const dismiss = useCallback(() => setNotice(null), []);
    const validate = useCallback((formElement, options) => {
        // Handle native field constraints ourselves so empty password fields do
        // not prevent onSubmit from displaying the same single warning toast.
        const invalidField = Array.from(formElement.elements).find(field =>
            !["password", "confirmPassword", "consent"].includes(field.name)
            && field.willValidate && !field.validity.valid
        );
        const requiredIssue = invalidField
            ? { field: invalidField.name, title: "Required Information", message: invalidField.validationMessage }
            : options.requiredIssue;
        const issue = getRegistrationIssue({ ...options, requiredIssue });
        if (!issue) { setNotice(null); return true; }
        setNotice({ ...issue, id: ++sequence.current });
        const target = invalidField || formElement.elements.namedItem(issue.field)
            || (issue.field === "document" ? formElement.querySelector('input[type="file"]') : null);
        if (target && !target.disabled) target.focus();
        return false;
    }, []);
    return { notice, dismiss, validate };
}
