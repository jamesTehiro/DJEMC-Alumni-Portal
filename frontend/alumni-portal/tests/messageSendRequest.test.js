import test from 'node:test';
import assert from 'node:assert/strict';
import { beginMessageRequest, finishMessageRequest } from '../src/utils/messageSendRequest.js';

test('rapid sends are suppressed and a lost response retains the same retry identity', () => {
    const ref = { current: null }, file = new File(['fixture'], 'test.pdf');
    const first = beginMessageRequest(ref, 'direct:9', 'Hello', file);
    assert.match(first.id, /^[a-f0-9-]{36}$/);
    assert.equal(beginMessageRequest(ref, 'direct:9', 'Hello', file), null);
    finishMessageRequest(ref, first.id, false);
    const retry = beginMessageRequest(ref, 'direct:9', 'Hello', file);
    assert.equal(retry.id, first.id);
    finishMessageRequest(ref, retry.id, true);
    assert.notEqual(beginMessageRequest(ref, 'direct:9', 'Hello', file).id, first.id);
});

test('changed drafts, threads and attachments use new identities; late completion cannot reset another attempt', () => {
    for (const changed of [['direct:10', 'Hello', null], ['direct:9', 'Other', null], ['direct:9', 'Hello', new File(['other'], 'test.pdf')]]) {
        const ref = { current: null };
        const first = beginMessageRequest(ref, 'direct:9', 'Hello', null);
        finishMessageRequest(ref, first.id, false);
        const next = beginMessageRequest(ref, ...changed);
        assert.notEqual(first.id, next.id);
        finishMessageRequest(ref, first.id, true);
        assert.equal(ref.current.id, next.id);
    }
});
