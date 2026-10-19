import test from 'node:test';
import assert from 'node:assert/strict';
import { getRegistrationIssue } from '../src/hooks/useRegistrationValidation.js';

const valid = { password: 'Exact Password 123', confirmPassword: 'Exact Password 123', consent: true };

test('required fields precede passwords, then empty passwords, mismatch and consent', () => {
    const requiredIssue = { title: 'Required Information', message: 'Complete the required fields.' };
    assert.equal(getRegistrationIssue({ ...valid, requiredIssue, password: '', consent: false }), requiredIssue);
    assert.equal(getRegistrationIssue({ ...valid, password: '', confirmPassword: '', consent: false }).title, 'Password Required');
    assert.equal(getRegistrationIssue({ ...valid, confirmPassword: '', consent: false }).title, 'Confirm Password Required');
    assert.deepEqual(getRegistrationIssue({ ...valid, confirmPassword: 'exact Password 123', consent: false }), {
        field: 'confirmPassword', title: 'Passwords Do Not Match',
        message: 'Your password and confirm password do not match. Please check and try again.'
    });
});

test('password comparison is case/whitespace sensitive and preserves the values', () => {
    for (const confirmPassword of ['exact Password 123', 'Exact Password 123 ', ' Exact Password 123']) {
        const values = { ...valid, confirmPassword }, snapshot = { ...values };
        assert.equal(getRegistrationIssue(values).title, 'Passwords Do Not Match');
        assert.deepEqual(values, snapshot);
    }
    assert.equal(getRegistrationIssue(valid), null);
});

test('each role receives the specified privacy reminder; matching accepted registrations pass', () => {
    for (const employer of [false, true]) {
        assert.deepEqual(getRegistrationIssue({ ...valid, consent: false, employer }), {
            field: 'consent', title: employer ? 'Data Privacy Consent Required' : 'Privacy Consent Required',
            message: employer ? 'Please review and accept the Data Privacy Consent before creating your employer account.' : 'Please review and accept the Privacy Consent before creating your account.'
        });
        assert.equal(getRegistrationIssue({ ...valid, employer }), null);
    }
});
