import { lazy, Suspense, useEffect, useState } from "react";
import { Route, Routes, useLocation } from "react-router-dom";
import "./App.css";
import NavigationBar from "./components/Navbar";
import DashboardLayout from "./components/DashboardLayout";
import ProtectedRoute from "./components/ProtectedRoute";
import LandingPage from "./pages/LandingPage";
import { UndoDeleteProvider } from "./context/UndoDeleteContext";
import UndoToast from "./components/UndoToast";

const Alumnipage = lazy(() => import("./pages/Alumnipage"));
const JobsPage = lazy(() => import("./pages/JobsPage"));
const FeedPage = lazy(() => import("./pages/FeedPage"));
const MessagesPage = lazy(() => import("./pages/MessagesPage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const ResumeBuilderPage = lazy(() => import("./pages/ResumeBuilderPage"));
const NotificationPage = lazy(() => import("./pages/NotificationPage"));
const AlumniLoginPage = lazy(() => import("./pages/AlumniLoginPage"));
const AlumniRegisterPage = lazy(() => import("./pages/AlumniRegisterPage"));
const EmployerLoginPage = lazy(() => import("./pages/EmployerLoginPage"));
const EmployerRegisterPage = lazy(() => import("./pages/EmployerRegisterPage"));
const AdminLoginPage = lazy(() => import("./pages/AdminLoginPage"));
const AdminCreatePage = lazy(() => import("./pages/AdminCreatePage"));
const ForgotPassword = lazy(() => import("./pages/ForgotPassword"));
const ResetPassword = lazy(() => import("./pages/ResetPassword"));
const EmployerPage = lazy(() => import("./pages/EmployerPage"));
const AdminAlumniPage = lazy(() => import("./pages/AdminAlumniPage"));
const AdminEmployerPage = lazy(() => import("./pages/AdminEmployerPage"));
const AdminPortalPage = lazy(() => import("./pages/AdminPortalPage"));
const RegistrarDashboardPage = lazy(() => import("./pages/RegistrarDashboardPage"));
const RegistrarVerificationQueuePage = lazy(() => import("./pages/RegistrarVerificationQueuePage"));
const RegistrarRecordsPage = lazy(() => import("./pages/RegistrarRecordsPage"));
const RegistrarAnalyticsPage = lazy(() => import("./pages/RegistrarAnalyticsPage"));
const RegistrarPendingAlumniPage = lazy(() => import("./pages/RegistrarPendingAlumniPage"));
const RegistrarMasterRecordsPage = lazy(() => import("./pages/RegistrarMasterRecordsPage"));
const RegistrarSettingsPage = lazy(() => import("./pages/RegistrarSettingsPage"));
const AdminUsersPage = lazy(() => import("./pages/admin/AdminUsersPage"));
const AdminSettingsPage = lazy(() => import("./pages/admin/AdminSettingsPage"));
const AdminMessagesPage = lazy(() => import("./pages/admin/AdminMessagesPage"));
const AdminLogsPage = lazy(() => import("./pages/admin/AdminLogsPage"));
const AdminModerationPage = lazy(() => import("./pages/admin/AdminModerationPage"));
const AdminVerificationPage = lazy(() => import("./pages/admin/AdminVerificationPage"));
const AdminEmployerApplicantsPage = lazy(() => import("./pages/admin/AdminEmployerApplicantsPage"));

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
            path="/admin/alumni"
            element={
              <ProtectedRoute allow={(user) => user.role === "admin" && user.admin_scope === "alumni"} redirectTo="/admin">
                <AdminAlumniPage />
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
                <EmployerPage hideRecruitmentActions={true} />
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