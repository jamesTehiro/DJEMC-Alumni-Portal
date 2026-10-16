import React, { useEffect, useMemo, useRef, useState } from "react";
import { Alert, Card, Button, Form, Modal } from "react-bootstrap";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import "./ProfilePage.css";
import { api, resolveFileUrl } from "../services/api";
import useRenderDebug from "../hooks/useRenderDebug";
import { fillEmptyProfileFields, membershipProfileChanges } from "../utils/membershipProfile";
import { createProfilePhotoFormData, validateProfilePhoto } from "../utils/profilePhotoUpload";

const blankWork = {
    company_name: "",
    position: "",
    start_year: "",
    end_year: "",
    employment_type: "Full-time"
};

const normalizeEmploymentHistory = (source) => {
    const raw =
        source?.EmploymentHistories ||
        source?.employment_histories ||
        source?.employmentHistory ||
        [];

    return Array.isArray(raw)
        ? raw.map((item) => ({
            id: item.id,
            company_name: item.company_name || "",
            position: item.position || "",
            start_year: item.start_year || "",
            end_year: item.end_year || "",
            employment_type: item.employment_type || "Full-time"
        }))
        : [];
};

export default function ProfilePage() {
    useRenderDebug("ProfilePage");
    const { userId } = useParams();
    const navigate = useNavigate();
    const [searchParams] = useSearchParams();
    const fromMembership = searchParams.get("membership") === "1";
    const saveLock = useRef(false);
    const membershipPrefill = useRef("");
    const [membership, setMembership] = useState(null);
    const [membershipError, setMembershipError] = useState("");
    const [membershipAttempt, setMembershipAttempt] = useState(0);
    const [showProfileSuccess, setShowProfileSuccess] = useState(false);
    const [showMembershipImport, setShowMembershipImport] = useState(false);
    const [profile, setProfile] = useState(null);
    const [form, setForm] = useState(null);
    const [avatarFile, setAvatarFile] = useState(null);
    const [avatarPreview, setAvatarPreview] = useState(null);
    const [avatarSaving, setAvatarSaving] = useState(false);
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [editing, setEditing] = useState(false);
    const [message, setMessage] = useState("");

    const currentUser = useMemo(() => {
        try {
            return JSON.parse(localStorage.getItem("user") || "null");
        } catch {
            return null;
        }
    }, []);

    const viewedUserId = userId ? Number(userId) : null;
    const viewingOtherProfile = !!viewedUserId && viewedUserId !== currentUser?.id;
    useEffect(() => () => {
        if (avatarPreview?.url?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview.url);
    }, [avatarPreview]);
    useEffect(() => {
        if (viewingOtherProfile || currentUser?.role !== "alumni") return;
        let active = true;
        api.get("/membership/me", true).then(data => {
            if (!active) return;
            if (!data || typeof data.completion?.submitted !== "boolean") throw new Error("Membership completion information is unavailable.");
            setMembership(data);
            setMembershipError("");
            if (fromMembership && data.completion.submitted) setEditing(true);
        }).catch(err => { if (active && ![401, 403].includes(err.status || err.response?.status)) setMembershipError(err.message); });
        return () => { active = false; };
    }, [currentUser, viewingOtherProfile, fromMembership, membershipAttempt]);

    useEffect(() => {
        const key = `${membership?.application?.id}:${profile?.id}`;
        if (fromMembership && !viewingOtherProfile && profile?.role === "alumni" && form && membership?.completion.submitted && profile?.id && membershipPrefill.current !== key) {
            membershipPrefill.current = key;
            setForm(previous => fillEmptyProfileFields(previous, membership.application));
        }
    }, [fromMembership, membership, profile?.id, profile?.role, viewingOtherProfile, form]);

    const toFormState = (data) => ({
        name: data?.name || "",
        email: data?.email || "",
        course: data?.AlumniProfile?.course || "",
        graduation_year: data?.AlumniProfile?.graduation_year || "",
        phone: data?.AlumniProfile?.phone || "",
        address: data?.AlumniProfile?.address || data?.EmployerProfile?.address || "",
        profile_visibility: data?.AlumniProfile?.profile_visibility || "public",
        avatar_url: data?.AlumniProfile?.avatar_url || "",
        employment_status: data?.AlumniProfile?.employment_status ?? null,
        job_title: data?.AlumniProfile?.job_title || "",

        logo_url: data?.EmployerProfile?.logo_url || "",
        organization_name: data?.EmployerProfile?.organization_name || "",

        industry: data?.EmployerProfile?.industry || "",
        contact_email: data?.EmployerProfile?.contact_email || "",
        admin_department: data?.admin_department || "",
        admin_avatar_url: data?.admin_avatar_url || "",
        employment_history: normalizeEmploymentHistory(data?.AlumniProfile)
    });

    useEffect(() => {
            let active = true;
            const loadProfile = async () => {
                setLoading(true);
                setError("");
                setMessage("");

                try {
                    const path = viewedUserId ? `/profile/${viewedUserId}` : "/profile";
                    const data = await api.get(path, true);
                    if (!active) return;
                    setProfile(data);

                    setForm(toFormState(data));
                } catch (err) {
                    if (active) setError(err.message);
                } finally {
                    if (active) setLoading(false);
                }
            };

            loadProfile();
            return () => { active = false; };
        }, [viewedUserId]);

    const alumniProfile = profile?.AlumniProfile;
    const employerProfile = profile?.EmployerProfile;
    const isAlumni = profile?.role === "alumni";
    const isEmployer = profile?.role === "employer";
    const isAdmin = profile?.role === "admin";
    const canEdit = !viewingOtherProfile;
    const resumeHistory = normalizeEmploymentHistory(alumniProfile);
    const profileImageField = isAdmin ? "admin_avatar_url" : isEmployer ? "logo_url" : "avatar_url";
    const storedProfileImage = isAdmin
        ? (form?.admin_avatar_url || profile?.admin_avatar_url)
        : isEmployer
            ? (form?.logo_url || employerProfile?.logo_url)
            : (form?.avatar_url || alumniProfile?.avatar_url);
    const profileImage = avatarPreview?.field === profileImageField
        ? avatarPreview.url
        : resolveFileUrl(storedProfileImage || "");

    const profileRoleLabel = isAdmin
        ? `Admin${profile?.admin_scope ? ` · ${profile.admin_scope}` : ""}`
        : isEmployer
            ? "Employer"
            : isAlumni
                ? "Alumni"
                : profile?.role || "N/A";

    const handleChange = (e) => {
        setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }));
    };

    const handleWorkChange = (index, field, value) => {
        setForm((prev) => {
            const nextHistory = [...(prev?.employment_history || [])];
            nextHistory[index] = { ...nextHistory[index], [field]: value };
            return { ...prev, employment_history: nextHistory };
        });
    };

    const addWorkExperience = () => {
        setForm((prev) => ({
            ...prev,
            employment_history: [...(prev?.employment_history || []), { ...blankWork }]
        }));
    };

    const removeWorkExperience = (index) => {
        setForm((prev) => ({
            ...prev,
            employment_history: (prev?.employment_history || []).filter((_, i) => i !== index)
        }));
    };

    const handleSave = async () => {
        if (!form || !canEdit || saveLock.current) return;
        saveLock.current = true;
        setSaving(true);
        setError("");
        setMessage("");

        try {
            const payload = {
                name: form.name,
                email: form.email
            };

            if (isAlumni) {
                payload.course = form.course;
                payload.graduation_year = form.graduation_year ? Number(form.graduation_year) : null;
                payload.phone = form.phone;
                payload.address = form.address;
                payload.profile_visibility = form.profile_visibility;
                payload.avatar_url = form.avatar_url || "";
                payload.employment_status = form.employment_status ?? null;
                payload.job_title = String(form.job_title || "").trim();
                payload.employment_history = (form.employment_history || []).map((item) => ({

                    company_name: item.company_name,
                    position: item.position,
                    start_year: item.start_year,
                    end_year: item.end_year,
                    employment_type: item.employment_type
                }));
                if (membership?.completion.submitted && !membership.completion.profile_completed) {
                    payload.membership_profile_completion = true;
                }
            }

            if (isEmployer) {
                payload.organization_name = form.organization_name;
                payload.industry = form.industry;
                payload.address = form.address;
                payload.contact_email = form.contact_email;
                payload.logo_url = form.logo_url || "";
            }

            if (isAdmin) {
                payload.admin_department = form.admin_department;
                payload.admin_avatar_url = form.admin_avatar_url || "";
            }

            let result;
            if (isAlumni && avatarFile) {
                setAvatarSaving(true);
                result = await api.put("/profile", createProfilePhotoFormData(payload, avatarFile), true);
            } else {
                result = await api.put("/profile", payload, true);
            }
            const updated = result?.user || await api.get("/profile", true);
            if (!updated?.id) throw new Error("The saved profile could not be loaded.");
            setProfile(updated);
            setForm((prev) => ({
                ...toFormState(updated),
                employment_status: updated?.AlumniProfile?.employment_status ?? prev?.employment_status
            }));
            if (avatarPreview?.url?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview.url);
            setAvatarPreview(null);
            setAvatarFile(null);
            setMessage(avatarFile ? "Profile photo saved successfully." : isAlumni ? "Profile Saved Successfully!" : "Profile updated.");
            setEditing(false);
            if (isAlumni) {
                setShowProfileSuccess(true);
                if (result?.membership_profile_completed) setMembership(previous => previous ? { ...previous, completion: { ...previous.completion, profile_completed: true } } : previous);
            }

            if (updated) {
                const storedUser = JSON.parse(localStorage.getItem("user") || "{}");
                localStorage.setItem("user", JSON.stringify({
                    ...storedUser,
                    name: updated.name,
                    email: updated.email,
                    role: updated.role,
                    id: updated.id,
                    ...(updated.admin_avatar_url !== undefined && { admin_avatar_url: updated.admin_avatar_url }),
                    ...(updated.AlumniProfile && { AlumniProfile: { ...storedUser.AlumniProfile, avatar_url: updated.AlumniProfile.avatar_url } }),
                    ...(updated.EmployerProfile && { EmployerProfile: { ...storedUser.EmployerProfile, logo_url: updated.EmployerProfile.logo_url } })
                }));
            }
        } catch (err) {
            setError(err.message);
        } finally {
            saveLock.current = false;
            setSaving(false);
            setAvatarSaving(false);
        }
    };

    const fileToDataUrl = (file) =>
        new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });

    const handleAvatarUpload = async () => {
        if (!avatarFile || !form || !canEdit || (!isAlumni && !isEmployer && !isAdmin)) {
            setError("Please select an image first.");
            return;
        }

        setAvatarSaving(true);
        setError("");
        setMessage("");
        try {
            const avatarUrl = await fileToDataUrl(avatarFile);
            const field = isAdmin ? "admin_avatar_url" : isEmployer ? "logo_url" : "avatar_url";
            setForm((prev) => ({ ...prev, [field]: avatarUrl }));
            setAvatarFile(null);
            if (avatarPreview?.url?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview.url);
            setAvatarPreview(null);
            setMessage("");
        } catch (err) {
            setError(err.message || "Failed to read image.");
        } finally {
            setAvatarSaving(false);
        }
    };

    const handleAvatarSelection = (event) => {
        const file = event.target.files?.[0] || null;
        setError("");
        setMessage("");
        if (!file) return;
        const validationError = validateProfilePhoto(file);
        if (validationError) {
            event.target.value = "";
            setAvatarFile(null);
            setAvatarPreview(null);
            setError(validationError);
            return;
        }
        if (avatarPreview?.url?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview.url);
        const field = isAdmin ? "admin_avatar_url" : isEmployer ? "logo_url" : "avatar_url";
        setAvatarFile(file);
        setAvatarPreview({ field, url: URL.createObjectURL(file) });
    };

    if (!loading && !error && viewingOtherProfile) {
        return (
            <div className="profile-page">
                <div className="profile-header">
                    <h2 className="profile-title">Profile</h2>
                    <p className="profile-subtitle">Quick profile preview.</p>
                </div>

                <Card className="profile-card">
                    <Card.Body>
                        <div className="resume-preview" style={{ gap: "14px" }}>
                            <div
                                className={`resume-avatar ${profileImage ? "with-photo" : ""}`}
                                style={profileImage ? { backgroundImage: `url(${profileImage})` } : undefined}
                            >
                                {!profileImage && "USER"}
                            </div>
                            <h5>{profile?.name || "N/A"}</h5>
                            <p className="resume-class">{profileRoleLabel}</p>
                        </div>
                    </Card.Body>
                </Card>
            </div>
        );
    }

    return (
        <div className="profile-page">
            <div className="profile-header">
                <h2 className="profile-title">{viewingOtherProfile ? "Profile" : "My Profile"}</h2>
                <p className="profile-subtitle">
                    {viewingOtherProfile
                        ? "Digital resume and professional details."
                        : "Manage your personal information and digital resume."}
                </p>
            </div>

            {loading && <p>Loading profile...</p>}
            {error && <p className="profile-alert profile-alert-error">{error}</p>}
            {message && <p className="profile-alert profile-alert-success">{message}</p>}
            {!viewingOtherProfile && currentUser?.role === "alumni" && membershipError && <Alert variant="warning">
                {membershipError} <Button variant="outline-success" size="sm" onClick={() => { setMembershipError(""); setMembershipAttempt(value => value + 1); }}>Retry Membership Check</Button>
            </Alert>}
            {!loading && form && isAlumni && canEdit && membership?.completion.submitted && !membership.completion.profile_completed && <Alert variant="success">
                Your membership application has been submitted. Review and save your profile to complete this step.
                <p className="mb-2">Existing profile information is preserved. Only empty compatible fields are prefilled when you proceed from the membership form.</p>
                <Button variant="outline-success" size="sm" disabled={saving || avatarSaving} onClick={() => { setEditing(true); setShowMembershipImport(true); }}>Use Membership Information</Button>
            </Alert>}
            <Modal show={showMembershipImport} onHide={() => setShowMembershipImport(false)} centered>
                <Modal.Header closeButton><Modal.Title>Use Membership Information</Modal.Title></Modal.Header>
                <Modal.Body>
                    <p>Review these replacements before applying them to your profile form. They are saved only when you click Save Profile.</p>
                    {membershipProfileChanges(form || {}, membership?.application).map(({ key, value }) => <p key={key}><strong>{({ name: "Name", phone: "Phone", address: "Address", job_title: "Job Title / Position" })[key]}:</strong> {value}</p>)}
                    {!membershipProfileChanges(form || {}, membership?.application).length && <p>These fields already match your membership information.</p>}
                </Modal.Body>
                <Modal.Footer>
                    <Button variant="outline-secondary" onClick={() => setShowMembershipImport(false)}>Cancel</Button>
                    <Button variant="success" disabled={loading || saving || avatarSaving || !form} onClick={() => {
                        setForm(previous => ({ ...previous, ...Object.fromEntries(membershipProfileChanges(previous || {}, membership?.application).map(({ key, value }) => [key, value])) }));
                        setShowMembershipImport(false);
                    }}>Apply to Profile Form</Button>
                </Modal.Footer>
            </Modal>
            <Modal show={showProfileSuccess} onHide={() => setShowProfileSuccess(false)} centered>
                <Modal.Header closeButton><Modal.Title>Profile Saved Successfully!</Modal.Title></Modal.Header>
                <Modal.Body>Your alumni profile has been updated successfully. You can now continue exploring the DJEMC Alumni Tracking and Job Portal.</Modal.Body>
                <Modal.Footer><Button variant="success" onClick={() => navigate("/dashboard")}>Continue to Dashboard →</Button></Modal.Footer>
            </Modal>

            {!loading && form && (
                <>
                    <Card className="profile-card">
                        <Card.Body>
                            <div className="profile-top-row">
                                <div className="profile-top">
                                    <div
                                        className={`profile-avatar ${profileImage ? "with-photo" : ""}`}
                                        style={
                                            profileImage
                                                ? { backgroundImage: `url(${profileImage})` }
                                                : undefined
                                        }
                                    >
                                        {!profileImage && "USER"}
                                    </div>

                                    <div>
                                        <h4 className="profile-name">{profile?.name || "No name"}</h4>
                                        {viewingOtherProfile && (
                                            <p className="profile-course">
                                                {alumniProfile?.course || employerProfile?.organization_name || "No profile info"}
                                            </p>
                                        )}
                                        <p className="profile-year">
                                            {isAlumni
                                                ? `Class of ${alumniProfile?.graduation_year || "N/A"}`
                                                : isAdmin
                                                    ? `Admin${profile?.admin_scope ? ` · ${profile.admin_scope}` : ""}`
                                                    : profile?.role || "N/A"}
                                        </p>
                                    </div>
                                </div>

                                {canEdit && !editing && (
                                    <Button className="edit-btn" onClick={() => setEditing(true)}>
                                        Edit Profile
                                    </Button>
                                )}
                            </div>

                            {editing ? (
                                <div className="profile-form">
                                    <h6 className="form-section-title">Basic Information</h6>
                                    <Form.Group className="mb-2">
                                        <Form.Label>Name</Form.Label>
                                        <Form.Control name="name" value={form?.name || ""} onChange={handleChange} />
                                    </Form.Group>
                                    <Form.Group className="mb-2">
                                        <Form.Label>Email</Form.Label>
                                        <Form.Control type="email" name="email" value={form?.email || ""} onChange={handleChange} />
                                    </Form.Group>

                                    {isAlumni && (
                                        <>
                                            <h6 className="form-section-title">Alumni Details</h6>
                                            <Form.Group className="mb-2">
                                                <Form.Label>Course</Form.Label>
                                                <Form.Control name="course" value={form?.course || ""} onChange={handleChange} />
                                            </Form.Group>
                                            <Form.Group className="mb-2">
                                                <Form.Label>Graduation Year</Form.Label>
                                                <Form.Control name="graduation_year" value={form?.graduation_year || ""} onChange={handleChange} />
                                            </Form.Group>
                                            <Form.Group className="mb-2">
                                                <Form.Label>Phone</Form.Label>
                                                <Form.Control name="phone" value={form?.phone || ""} onChange={handleChange} />
                                            </Form.Group>
                                            <Form.Group className="mb-2">
                                                <Form.Label>Address</Form.Label>
                                                <Form.Control name="address" value={form?.address || ""} onChange={handleChange} />
                                            </Form.Group>
                                            <Form.Group className="mb-2">
                                                <Form.Label>Job Title / Position</Form.Label>
                                                <Form.Control
                                                    name="job_title"
                                                    value={form?.job_title || ""}
                                                    onChange={handleChange}
                                                    maxLength={255}
                                                    placeholder="e.g. Guidance Counselor"
                                                />
                                            </Form.Group>
                                            <Form.Group className="mb-3">
                                                <Form.Label>Profile Photo</Form.Label>
                                                <div className="avatar-upload-row">
                                                    <Form.Control
                                                        type="file"
                                                        accept=".png,.jpg,.jpeg,.webp,.gif"
                                                        onChange={handleAvatarSelection}
                                                    />
                                                    {!isAlumni && <Button
                                                        variant="outline-success"
                                                        onClick={handleAvatarUpload}
                                                        disabled={avatarSaving}
                                                    >
                                                        {avatarSaving ? "Uploading..." : "Upload"}
                                                    </Button>}
                                                </div>
                                                {(avatarFile || String(form?.avatar_url || "").startsWith("data:image/")) && <small role="status">Photo preview selected. Save Profile to upload and save it.</small>}
                                            </Form.Group>

                                            <h6 className="form-section-title">Employment Status</h6>
                                            <Form.Group className="mb-3">
                                                <Form.Label>Employment Status</Form.Label>
                                                <Form.Select
                                                    name="employment_status"
                                                    value={form?.employment_status || ""}
                                                    onChange={handleChange}
                                                >
                                                    <option value="">Select...</option>
                                                    <option value="employed">Employed</option>
                                                    <option value="unemployed">Unemployed</option>
                                                    <option value="self-employed">Self-Employed</option>
                                                </Form.Select>
                                            </Form.Group>

                                            <h6 className="form-section-title">Employment History</h6>

                                            {(form?.employment_history || []).map((work, index) => (
                                                <div className="work-item" key={`work-${index}`}>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label>Company/Agency Name</Form.Label>
                                                        <Form.Control
                                                            value={work.company_name}
                                                            onChange={(e) => handleWorkChange(index, "company_name", e.target.value)}
                                                        />
                                                    </Form.Group>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label>Position</Form.Label>
                                                        <Form.Control
                                                            value={work.position}
                                                            onChange={(e) => handleWorkChange(index, "position", e.target.value)}
                                                        />
                                                    </Form.Group>
                                                    <div className="work-row">
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>Start Year</Form.Label>
                                                            <Form.Control
                                                                value={work.start_year}
                                                                onChange={(e) => handleWorkChange(index, "start_year", e.target.value)}
                                                            />
                                                        </Form.Group>
                                                        <Form.Group className="mb-2">
                                                            <Form.Label>End Year (or Present)</Form.Label>
                                                            <Form.Control
                                                                placeholder="Present"
                                                                value={work.end_year}
                                                                onChange={(e) => handleWorkChange(index, "end_year", e.target.value)}
                                                            />
                                                        </Form.Group>
                                                    </div>
                                                    <Form.Group className="mb-2">
                                                        <Form.Label>Employment Status</Form.Label>
                                                        <Form.Select
                                                            value={work.employment_type}
                                                            onChange={(e) => handleWorkChange(index, "employment_type", e.target.value)}
                                                        >
                                                            <option value="Full-time">Full-time</option>
                                                            <option value="Part-time">Part-time</option>
                                                            <option value="Self-employed">Self-employed</option>
                                                            <option value="Contract">Contract</option>
                                                            <option value="Internship">Internship</option>
                                                        </Form.Select>
                                                    </Form.Group>
                                                    <Button variant="outline-danger" size="sm" onClick={() => removeWorkExperience(index)}>
                                                        Remove
                                                    </Button>
                                                </div>
                                            ))}

                                            <Button variant="outline-success" size="sm" onClick={addWorkExperience}>
                                                Add Employment
                                            </Button>
                                        </>
                                    )}

                                    {isEmployer && (
                                        <>
                                            <h6 className="form-section-title">Employer Details</h6>
                                            <Form.Group className="mb-2">
                                                <Form.Label>Organization Name</Form.Label>
                                                <Form.Control name="organization_name" value={form?.organization_name || ""} onChange={handleChange} />
                                            </Form.Group>
                                            <Form.Group className="mb-2">
                                                <Form.Label>Industry</Form.Label>
                                                <Form.Control name="industry" value={form?.industry || ""} onChange={handleChange} />
                                            </Form.Group>
                                            <Form.Group className="mb-2">
                                                <Form.Label>Address</Form.Label>
                                                <Form.Control name="address" value={form?.address || ""} onChange={handleChange} />
                                            </Form.Group>
                                            <Form.Group className="mb-3">
                                                <Form.Label>Contact Email</Form.Label>
                                                <Form.Control
                                                    type="email"
                                                    name="contact_email"
                                                    value={form?.contact_email || ""}
                                                    onChange={handleChange}
                                                />
                                            </Form.Group>
                                            <Form.Group className="mb-3">
                                                <Form.Label>Profile Logo</Form.Label>
                                                <div className="avatar-upload-row">
                                                    <Form.Control
                                                        type="file"
                                                        accept=".png,.jpg,.jpeg,.webp,.gif"
                                                        onChange={handleAvatarSelection}
                                                    />
                                                    <Button
                                                        variant="outline-success"
                                                        onClick={handleAvatarUpload}
                                                        disabled={avatarSaving}
                                                    >
                                                        {avatarSaving ? "Uploading..." : "Upload"}
                                                    </Button>
                                                </div>
                                                {(avatarFile || String(form?.logo_url || "").startsWith("data:image/")) && <small role="status">Photo preview selected. Save to upload and save it.</small>}
                                            </Form.Group>
                                        </>
                                    )}

                                    {isAdmin && (
                                        <>
                                            <h6 className="form-section-title">Admin Details</h6>
                                            <Form.Group className="mb-2">
                                                <Form.Label>Department</Form.Label>
                                                <Form.Control name="admin_department" value={form?.admin_department || ""} onChange={handleChange} />
                                            </Form.Group>
                                            <Form.Group className="mb-3">
                                                <Form.Label>Profile Avatar</Form.Label>
                                                <div className="avatar-upload-row">
                                                    <Form.Control
                                                        type="file"
                                                        accept=".png,.jpg,.jpeg,.webp,.gif"
                                                        onChange={handleAvatarSelection}
                                                    />
                                                    <Button
                                                        variant="outline-success"
                                                        onClick={handleAvatarUpload}
                                                        disabled={avatarSaving}
                                                    >
                                                        {avatarSaving ? "Uploading..." : "Upload"}
                                                    </Button>
                                                </div>
                                                {(avatarFile || String(form?.admin_avatar_url || "").startsWith("data:image/")) && <small role="status">Photo preview selected. Save to upload and save it.</small>}
                                            </Form.Group>
                                        </>
                                    )}

                                    <div className="profile-actions">
                                        <Button className="edit-btn" onClick={handleSave} disabled={saving || avatarSaving}>
                                            {saving ? "Saving..." : isAlumni ? "Save Profile" : "Save"}
                                        </Button>
                                        <Button
                                            variant="outline-secondary"
                                            disabled={saving || avatarSaving}
                                            onClick={() => {
                                                if (avatarPreview?.url?.startsWith("blob:")) URL.revokeObjectURL(avatarPreview.url);
                                                setAvatarPreview(null);
                                                setAvatarFile(null);
                                                setEditing(false);
                                                setMessage("");
                                                setError("");
                                                setForm(toFormState(profile));
                                            }}
                                        >
                                            Cancel
                                        </Button>
                                    </div>
                                </div>
                            ) : (
                                <div className="profile-info-grid">
                                    <div className="profile-info-box">
                                        <span>Email</span>
                                        <p>{profile?.email || "N/A"}</p>
                                    </div>
                                    <div className="profile-info-box">
                                        <span>Address</span>
                                        <p>{alumniProfile?.address || employerProfile?.address || "N/A"}</p>
                                    </div>
                                    <div className="profile-info-box">
                                        <span>Phone</span>
                                        <p>{alumniProfile?.phone || "N/A"}</p>
                                    </div>
                                </div>
                            )}
                        </Card.Body>
                    </Card>

                    <Card className="resume-card">
                        <Card.Body>
                            <h5 className="resume-title">Digital Resume Preview</h5>

                            <div className="resume-preview">
                                <div
                                    className={`resume-avatar ${profileImage ? "with-photo" : ""}`}
                                    style={profileImage ? { backgroundImage: `url(${profileImage})` } : undefined}
                                >
                                    {!profileImage && "USER"}
                                </div>

                                <h5>{profile?.name || "N/A"}</h5>
                                <p>{alumniProfile?.course || employerProfile?.organization_name || "N/A"}</p>
                                {isAlumni && (editing ? form?.job_title : alumniProfile?.job_title) && (
                                    <p className="resume-job-title">{editing ? form.job_title : alumniProfile.job_title}</p>
                                )}
                                <p className="resume-class">
                                    {isAlumni ? `Class of ${alumniProfile?.graduation_year || "N/A"}` : profile?.role || "N/A"}
                                </p>

                                {isAlumni && (() => {


                                    const previewEmploymentStatus =
                                        form?.employment_status ??
                                        profile?.AlumniProfile?.employment_status ??
                                        profile?.employment_status ??
                                        null;

                                    return (
                                        <p className="resume-bio">
                                            Employment Status: {previewEmploymentStatus || "Not specified"}
                                        </p>
                                    );
                                })()}

                                <p className="resume-bio">{alumniProfile?.address || employerProfile?.address || "No bio available."}</p>

                                {isAlumni && (

                                    <div className="resume-work-list">
                                        <h6>Employment History</h6>
                                        {resumeHistory.length === 0 && (
                                            <p className="resume-work-empty">No employment history added yet.</p>
                                        )}
                                        {resumeHistory.map((item, index) => (
                                            <div className="resume-work-item" key={item.id || index}>
                                                <strong>{item.position}</strong> at {item.company_name}
                                                <div className="resume-work-meta">
                                                    {item.start_year} - {item.end_year || "Present"} | {item.employment_type || "Full-time"}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </Card.Body>
                    </Card>
                </>
            )}
        </div>
    );
}


