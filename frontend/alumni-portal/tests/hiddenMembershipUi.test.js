import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("Alumni dashboard and profile no longer expose membership application prompts or shortcuts", () => {
    const dashboardLayout = source("../src/components/DashboardLayout.jsx");
    const dashboard = source("../src/pages/Alumnipage.jsx");
    const profile = source("../src/pages/ProfilePage.jsx");

    assert.doesNotMatch(dashboardLayout, /MembershipFlowProvider|Membership Application|useMembershipFlow/);
    assert.doesNotMatch(dashboard, /MembershipOnboarding|membership application/i);
    assert.doesNotMatch(profile, /membership application|membership status|Use Membership Information|membership\/me|membership_profile_completion/i);
    assert.match(dashboardLayout, /Dashboard[\s\S]*Jobs[\s\S]*Feed[\s\S]*Messages[\s\S]*Profile[\s\S]*Resume Builder/);
});

test("Admin Alumni hides membership navigation without removing the guarded application route", () => {
    const shell = source("../src/components/AdminShell.jsx");
    const app = source("../src/App.jsx");
    const page = source("../src/pages/admin/AdminMembershipApplicationsPage.jsx");
    const menus = shell.slice(shell.indexOf("const itemsByScope"), shell.indexOf("const items ="));
    const alumniItems = menus.slice(menus.indexOf("alumni: ["), menus.indexOf("employer: ["));
    const employerItems = menus.slice(menus.indexOf("employer: ["), menus.indexOf("registrar: ["));

    assert.doesNotMatch(alumniItems, /Membership Applications/);
    assert.doesNotMatch(shell, /membership\/access/);
    assert.match(employerItems, /Manage Posted Jobs/);
    assert.match(employerItems, /Post Job/);
    assert.match(app, /path="\/admin\/alumni\/membership-applications"/);
    assert.match(page, /const scope = "alumni"/);
    assert.match(page, /isMembershipManagementUser\(user\)/);
});

test("legacy Alumni membership URL redirects without opening the modal; membership UI implementation remains available", () => {
    const app = source("../src/App.jsx");
    const dashboard = source("../src/components/DashboardLayout.jsx");
    const form = source("../src/pages/MembershipApplicationPage.jsx");

    assert.match(app, /path="\/membership-application" element=\{<Navigate to="\/dashboard" replace \/>/);
    assert.doesNotMatch(app, /openMembershipApplication/);
    assert.doesNotMatch(dashboard, /MembershipFlowProvider/);
    assert.match(form, /Submit Membership Application/);
});
