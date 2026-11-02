import test from 'node:test';
import assert from 'node:assert/strict';
import { registrationNotice } from '../src/features/auth/utils/adminSetupStatus.js';

test('registration notices distinguish bootstrap, OTP, capacity, disabled registration and backend availability', () => {
    const cases = [
        [{ registrationReason: 'ADMIN_BOOTSTRAP_UNAVAILABLE' }, /bootstrap secret/],
        [{ registrationReason: 'ADMIN_OTP_UNAVAILABLE' }, /OTP email configuration/],
        [{ setupComplete: true }, /all three authorized administrator accounts/],
        [{ registrationConfigured: false }, /registration is temporarily unavailable/]
    ];
    for (const [status, expected] of cases) {
        const text = registrationNotice(status);
        assert.match(text, expected); assert.match(text, /Existing administrators can still sign in/);
    }
    assert.match(registrationNotice(null, { status: 503, message: 'Admin bootstrap is not configured.' }), /bootstrap secret/);
    assert.match(registrationNotice(null, { status: 503, code: 'ADMIN_STATUS_UNAVAILABLE' }), /backend may be temporarily unavailable/);
    assert.match(registrationNotice(null, { message: 'Network Error' }), /try signing in/);
    assert.equal(registrationNotice({ registrationAvailable: true, registrationConfigured: true }), '');
    assert.equal(registrationNotice(null), '');
});
