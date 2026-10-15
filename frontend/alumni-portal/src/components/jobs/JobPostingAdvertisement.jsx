import React from "react";
import { getEmploymentTypeLabel } from "../../utils/employmentTypes";
import { cleanPostingList, jobCompanyName, postingDetailsOf, salaryDisplay, WORK_SETUP_OPTIONS } from "../../utils/jobPosting";
import "./JobPosting.css";

const readable = (value) => typeof value === "string" ? value.trim() : "";
const PostingSection = ({ title, children }) => <section className="job-ad-section"><h3>{title}</h3>{children}</section>;
const PostingList = ({ items }) => <ul>{items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ul>;
const dateLabel = (value) => {
    if (!readable(value)) return "";
    const date = new Date(`${value}T00:00:00`);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-PH", { year: "numeric", month: "long", day: "numeric" });
};

export default function JobPostingAdvertisement({ job, requirements, companyName }) {
    const details = postingDetailsOf(job);
    const qualification = details?.required_qualifications || {};
    const application = details?.application || {};
    const responsibilities = cleanPostingList(details?.responsibilities);
    const required = cleanPostingList([qualification.education, qualification.experience, ...cleanPostingList(qualification.skills), ...cleanPostingList(qualification.other)]);
    const preferred = cleanPostingList(details?.preferred_qualifications);
    const benefits = cleanPostingList([...cleanPostingList(details?.benefits?.government), ...cleanPostingList(details?.benefits?.additional), ...cleanPostingList(details?.benefits?.other)]);
    const configuredRequirements = Array.isArray(requirements) ? requirements : Array.isArray(job?.JobRequirements) ? job.JobRequirements : Array.isArray(job?.requirements) ? job.requirements : [];
    const company = companyName || jobCompanyName(job);
    const industry = readable(details?.industry) || readable(job?.User?.EmployerProfile?.industry);
    const salary = salaryDisplay(details?.compensation, job?.expected_salary);
    const workSetup = WORK_SETUP_OPTIONS.find(option => option.value === details?.work_setup)?.label;
    const vacancyCount = Number(details?.vacancy_count);
    const visibleContact = application.publish_contact === true && [application.contact_email, application.contact_number, application.walk_in_address, application.office_hours].some(readable);
    return (
        <article className="job-advertisement">
            <header className="job-ad-header">
                <p className="job-ad-kicker">WE ARE HIRING!</p>
                <h2>{readable(job?.title) || "Job Opportunity"}</h2>
                {company && <p className="job-ad-company">{company}</p>}
                <dl className="job-ad-facts">
                    {readable(job?.location) && <div><dt>Location</dt><dd>{job.location}</dd></div>}
                    {job?.employment_type && <div><dt>Employment Type</dt><dd>{getEmploymentTypeLabel(job.employment_type)}</dd></div>}
                    {workSetup && <div><dt>Work Setup</dt><dd>{workSetup}</dd></div>}
                    {Number.isSafeInteger(vacancyCount) && vacancyCount > 0 && <div><dt>Vacancies</dt><dd>{vacancyCount}</dd></div>}
                    {industry && <div><dt>Industry</dt><dd>{industry}</dd></div>}
                </dl>
            </header>
            {readable(details?.company_description) && <PostingSection title="About the Company"><p>{details.company_description}</p></PostingSection>}
            {readable(job?.description) && <PostingSection title="About the Role"><p>{job.description}</p></PostingSection>}
            {responsibilities.length > 0 && <PostingSection title="Key Responsibilities"><PostingList items={responsibilities} /></PostingSection>}
            {(required.length > 0 || readable(job?.course_target) || readable(qualification.preferred_start_date)) && <PostingSection title="Required Qualifications">
                {required.length > 0 && <PostingList items={required} />}
                {readable(job?.course_target) && <p>{details ? "Academic Program / Qualification: " : ""}{job.course_target}</p>}
                {readable(qualification.preferred_start_date) && <p><strong>Preferred Start Date:</strong> {dateLabel(qualification.preferred_start_date)}</p>}
            </PostingSection>}
            {preferred.length > 0 && <PostingSection title="Preferred Qualifications"><PostingList items={preferred} /></PostingSection>}
            {(salary || benefits.length > 0) && <PostingSection title="Compensation & Benefits">
                {salary && <p><strong>Salary:</strong> {salary}</p>}
                {benefits.length > 0 && <PostingList items={benefits} />}
            </PostingSection>}
            <PostingSection title="How to Apply">
                <p>Apply through the DJEMC Alumni Tracking and Job Portal.</p>
                {readable(application.instructions) && <p>{application.instructions}</p>}
                {visibleContact && <dl className="job-ad-contacts">
                    {readable(application.contact_email) && <div><dt>Contact Email</dt><dd>{application.contact_email}</dd></div>}
                    {readable(application.contact_number) && <div><dt>Contact Number</dt><dd>{application.contact_number}</dd></div>}
                    {readable(application.walk_in_address) && <div><dt>Walk-in Address</dt><dd>{application.walk_in_address}</dd></div>}
                    {readable(application.office_hours) && <div><dt>Office Hours</dt><dd>{application.office_hours}</dd></div>}
                </dl>}
            </PostingSection>
            {readable(application.deadline) && <PostingSection title="Application Deadline"><p>{dateLabel(application.deadline)}</p></PostingSection>}
            {configuredRequirements.length > 0 && <PostingSection title="Application Requirements">
                <ul>{configuredRequirements.filter(requirement => readable(requirement?.label)).map((requirement, index) => (
                    <li key={requirement.id || requirement.requirement_code || index}>
                        <strong>{requirement.label}</strong> <span>({requirement.required ? "Required" : "Optional"}; {requirement.requirement_type === "information_field" ? "Information Field" : "Document Upload"})</span>
                    </li>
                ))}</ul>
            </PostingSection>}
        </article>
    );
}
