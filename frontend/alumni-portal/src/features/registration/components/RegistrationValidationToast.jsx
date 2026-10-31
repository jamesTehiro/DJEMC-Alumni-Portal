import { useEffect, useState } from "react";
import RegistrationSuccessToast from "./RegistrationSuccessToast";
import "./RegistrationValidationToast.css";

function TimedValidationToast({ notice, onClose }) {
    const [closing, setClosing] = useState(false);
    useEffect(() => {
        const timer = setTimeout(() => setClosing(true), 3500);
        return () => clearTimeout(timer);
    }, []);
    useEffect(() => {
        if (!closing) return;
        const timer = setTimeout(onClose, 180);
        return () => clearTimeout(timer);
    }, [closing, onClose]);
    return <RegistrationSuccessToast
        show title={notice.title} message={notice.message} variant="error"
        onClose={() => setClosing(true)}
        positionerClassName={`registration-validation-toast${closing ? " registration-validation-toast--closing" : ""}`}
    />;
}

export default function RegistrationValidationToast({ notice, onClose }) {
    return notice ? <TimedValidationToast key={notice.id} notice={notice} onClose={onClose} /> : null;
}
