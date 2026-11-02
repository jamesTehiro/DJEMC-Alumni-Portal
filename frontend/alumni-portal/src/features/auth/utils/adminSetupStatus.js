export function registrationNotice(status, failure) {
    if (failure) {
        if (failure.code === 'ADMIN_BOOTSTRAP_UNAVAILABLE' || failure.message === 'Admin bootstrap is not configured.')
            return 'Admin registration is unavailable because the bootstrap secret is missing or invalid. Existing administrators can still sign in.';
        return 'Admin registration availability could not be checked. The backend may be temporarily unavailable. You can still try signing in.';
    }
    if (!status) return '';
    if (status.setupComplete || status.registrationReason === 'ADMIN_LIMIT_REACHED')
        return 'Admin account limit reached. The portal already has all three authorized administrator accounts. Existing administrators can still sign in.';
    if (status.registrationReason === 'ADMIN_BOOTSTRAP_UNAVAILABLE')
        return 'Admin registration is unavailable because the bootstrap secret is missing or invalid. Existing administrators can still sign in.';
    if (status.registrationReason === 'ADMIN_OTP_UNAVAILABLE')
        return 'Admin registration is unavailable because OTP email configuration is incomplete or invalid. Existing administrators can still sign in.';
    if (!status.registrationConfigured || status.registrationAvailable === false)
        return 'Admin registration is temporarily unavailable. Existing administrators can still sign in.';
    return '';
}
