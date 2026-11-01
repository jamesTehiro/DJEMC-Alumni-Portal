import { lazy, Suspense, useEffect, useState } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import "./App.css";
import NavigationBar from "../components/layout/Navbar";
import DashboardLayout from "../components/layout/DashboardLayout";
import AdminAlumniLayout from "../components/layout/AdminAlumniLayout";
import ProtectedRoute from "./ProtectedRoute";
import LandingPage from "../features/public-site/pages/LandingPage";
import { UndoDeleteProvider } from "../contexts/UndoDeleteContext";
import UndoToast from "../components/ui/UndoToast";
import { isMembershipManagementUser } from "../features/membership/utils/membershipManagement";
// Keep the resume builder's layout and document styles available when its lazy route loads.
import "../features/resumes/pages/ResumeBuilderPage.css";
import "../features/resumes/components/ResumeTemplates.css";
import "../features/resumes/components/TemplateSelector.css";

const Alumnipage = lazy(() => import("../features/dashboard/alumni/Alumnipage"));
const JobsPage = lazy(() => import("../features/jobs/pages/JobsPage"));
const FeedPage = lazy(() => import("../features/announcements/pages/FeedPage"));
const MessagesPage = lazy(() => import("../features/messaging/pages/MessagesPage"));
const ProfilePage = lazy(() => import("../features/profiles/pages/ProfilePage"));
const AdminMembershipApplicationsPage = lazy(() => import("../features/membership/pages/AdminMembershipApplicationsPage"));
const ResumeBuilderPage = lazy(() => import("../features/resumes/pages/ResumeBuilderPage"));
const NotificationPage = lazy(() => import("../features/notifications/pages/NotificationPage"));
const AlumniLoginPage = lazy(() => import("../features/auth/pages/AlumniLoginPage"));
const AlumniRegisterPage = lazy(() => import("../features/registration/pages/AlumniRegisterPage"));
const EmployerLoginPage = lazy(() => import("../features/auth/pages/EmployerLoginPage"));
const EmployerRegisterPage = lazy(() => import("../features/registration/pages/EmployerRegisterPage"));
const AdminLoginPage = lazy(() => import("../features/auth/pages/AdminLoginPage"));
const AdminCreatePage = lazy(() => import("../features/auth/pages/AdminCreatePage"));
const ForgotPassword = lazy(() => import("../features/auth/pages/ForgotPassword"));
const ResetPassword = lazy(() => import("../features/auth/pages/ResetPassword"));
const EmployerPage = lazy(() => import("../features/dashboard/employer/EmployerPage"));
const AdminAlumniPage = lazy(() => import("../features/dashboard/admin-alumni/AdminAlumniPage"));
const AdminEmployerPage = lazy(() => import("../features/dashboard/admin-employer/AdminEmployerPage"));
const AdminPortalPage = lazy(() => import("../features/auth/pages/AdminPortalPage"));
const RegistrarDashboardPage = lazy(() => import("../features/dashboard/registrar/RegistrarDashboardPage"));
const RegistrarVerificationQueuePage = lazy(() => import("../features/verification/pages/RegistrarVerificationQueuePage"));
const RegistrarRecordsPage = lazy(() => import("../features/alumni-records/pages/RegistrarRecordsPage"));
const RegistrarAnalyticsPage = lazy(() => import("../features/dashboard/registrar/RegistrarAnalyticsPage"));
const RegistrarPendingAlumniPage = lazy(() => import("../features/verification/pages/RegistrarPendingAlumniPage"));
const RegistrarMasterRecordsPage = lazy(() => import("../features/alumni-records/pages/RegistrarMasterRecordsPage"));
const RegistrarSettingsPage = lazy(() => import("../features/settings/pages/RegistrarSettingsPage"));
const AdminUsersPage = lazy(() => import("../features/alumni-records/pages/AdminUsersPage"));
const AdminSettingsPage = lazy(() => import("../features/settings/pages/AdminSettingsPage"));
const AdminMessagesPage = lazy(() => import("../features/messaging/pages/AdminMessagesPage"));
const AdminLogsPage = lazy(() => import("../features/activity-logs/pages/AdminLogsPage"));
const AdminModerationPage = lazy(() => import("../features/announcements/admin/AdminModerationPage"));
const AdminVerificationPage = lazy(() => import("../features/verification/pages/AdminVerificationPage"));
const AdminEmployerApplicantsPage = lazy(() => import("../features/jobs/pages/AdminEmployerApplicantsPage"));

const PUBLIC_PAGE_BY_PATH = {
  "/": "landing",
  "/about": "about",
  "/contact": "contact"
};

function getPublicPage(pathname) {
  return PUBLIC_PAGE_BY_PATH[pathname] ?? "landing";
}

function renderPublicPage(currentPage) {
  return currentPage;
}

function App() {
  const location = useLocation();
  const isPublicRoute = Object.hasOwn(PUBLIC_PAGE_BY_PATH, location.pathname);
  const [currentPage, setCurrentPage] = useState(() => getPublicPage(location.pathname));

  useEffect(() => {
    if (isPublicRoute) {
      setCurrentPage(getPublicPage(location.pathname));
    }
  }, [isPublicRoute, location.pathname]);

  if (isPublicRoute) {
    return (
      <>
        <NavigationBar currentPage={currentPage} onNavigate={setCurrentPage} />
        <main className="public-main-container">
          <div className="public-page-transition">
            <LandingPage
              currentPage={renderPublicPage(currentPage)}
              onSectionChange={setCurrentPage}
            />
          </div>
        </main>
      </>
    );
  }

  return (
    <UndoDeleteProvider>
      <NavigationBar />
      <Suspense fallback={<div className="route-loading">Loading...</div>}>
        <Routes>
          <Route element={
            <ProtectedRoute allow={isMembershipManagementUser} redirectTo="/admin">
              <AdminAlumniLayout />
            </ProtectedRoute>
          }>
          <Route
            path="/admin/alumni"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "alumni"} redirectTo="/admin">
                <AdminAlumniPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/alumni/membership-applications"
            element={
              <ProtectedRoute allow={isMembershipManagementUser} redirectTo="/admin">
                <AdminMembershipApplicationsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/alumni/verification"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "alumni"} redirectTo="/admin">
                <AdminVerificationPage role="alumni" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/alumni/users"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "alumni"} redirectTo="/admin">
                <AdminUsersPage role="alumni" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/alumni/moderation"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "alumni"} redirectTo="/admin">
                <AdminModerationPage role="alumni" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/alumni/logs"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "alumni"} redirectTo="/admin">
                <AdminLogsPage role="alumni" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/alumni/settings"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "alumni"} redirectTo="/admin/login">
                <AdminSettingsPage role="alumni" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/alumni/messages"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "alumni"} redirectTo="/admin">
                <AdminMessagesPage role="alumni" />
              </ProtectedRoute>
            }
          />
          </Route>
          <Route path="/login" element={<AlumniLoginPage />} />
          <Route path="/login/alumni" element={<AlumniLoginPage />} />
          <Route path="/login/employer" element={<EmployerLoginPage />} />
          <Route path="/login/admin" element={<AdminLoginPage />} />
          <Route path="/adminhashpages" element={<AdminLoginPage />} />
          <Route path="/register" element={<AlumniRegisterPage />} />
          <Route path="/register/employer" element={<EmployerRegisterPage />} />
          <Route path="/admin/create" element={<AdminCreatePage />} />
          <Route path="/forgot-password" element={<ForgotPassword />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route
            path="/employer"
            element={
              <ProtectedRoute allow={(user) => user.role === "employer" || (user.role === "admin" && user.admin_scope === "employer")} redirectTo="/login/employer">
                <EmployerPage />
              </ProtectedRoute>
            }
          />
          <Route path="/admin" element={<AdminPortalPage />} />
          <Route
            path="/admin/registrar"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "registrar"} redirectTo="/admin/login">
                <RegistrarDashboardPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/registrar/dashboard"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "registrar"} redirectTo="/admin">
                <RegistrarDashboardPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/registrar/pending-alumni"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "registrar"} redirectTo="/admin">
                <RegistrarPendingAlumniPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/registrar/master-records"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "registrar"} redirectTo="/admin">
                <RegistrarMasterRecordsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/registrar/verification"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "registrar"} redirectTo="/admin">
                <RegistrarVerificationQueuePage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/registrar/records"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "registrar"} redirectTo="/admin">
                <RegistrarRecordsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/registrar/analytics"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "registrar"} redirectTo="/admin">
                <RegistrarAnalyticsPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/registrar/settings"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "registrar"} redirectTo="/admin">
                <RegistrarSettingsPage />
              </ProtectedRoute>
            }
          />

          <Route
            path="/admin/employer"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "employer"} redirectTo="/admin">
                <AdminEmployerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/employer/verification"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "employer"} redirectTo="/admin">
                <AdminVerificationPage role="employer" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/employer/users"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "employer"} redirectTo="/admin">
                <EmployerPage />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/employer/applicants"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "employer"} redirectTo="/admin">
                <AdminEmployerApplicantsPage />
              </ProtectedRoute>
            }
          />

          <Route path="/admin/registrar/membership-applications" element={<Navigate to="/admin/alumni/membership-applications" replace />} />
          <Route path="/admin/employer/membership-applications" element={<Navigate to="/admin/alumni/membership-applications" replace />} />
          <Route
            path="/admin/employer/moderation"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "employer"} redirectTo="/admin">
                <AdminModerationPage role="employer" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/employer/logs"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "employer"} redirectTo="/admin">
                <AdminLogsPage role="employer" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/employer/settings"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "employer"} redirectTo="/admin/login">
                <AdminSettingsPage role="employer" />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin/employer/messages"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "employer"} redirectTo="/admin">
                <AdminMessagesPage role="employer" />
              </ProtectedRoute>
            }
          />







          <Route
            element={
              <ProtectedRoute allow={(user) => user.role === "alumni"} redirectTo="/login/alumni">
                <DashboardLayout />
              </ProtectedRoute>
            }
          >
            <Route path="/alumni" element={<Alumnipage />} />
            <Route path="/dashboard" element={<Alumnipage />} />
            <Route path="/jobs" element={<JobsPage />} />
            <Route path="/feed" element={<FeedPage />} />
            <Route path="/messages" element={<MessagesPage />} />
            <Route path="/notifications" element={<NotificationPage />} />
            <Route path="/profile" element={<ProfilePage />} />
            <Route path="/membership-application" element={<Navigate to="/dashboard" replace />} />
            <Route path="/profile/:userId" element={<ProfilePage />} />
            <Route path="/resume-builder" element={<ResumeBuilderPage />} />
          </Route>
        </Routes>
      </Suspense>
      <UndoToast />
    </UndoDeleteProvider>
  );
}

export default App;
