const test = require("node:test");
const assert = require("node:assert/strict");

const db = require("../models");
const notificationController = require("../controllers/notificationController");

const response = () => ({
    statusCode: 200,
    body: null,
    status(code) { this.statusCode = code; return this; },
    json(body) { this.body = body; return this; }
});

test("alumni can retrieve the saved interview snapshot attached to their notification", async () => {
    const invitation = {
        id: 405,
        userId: 12,
        type: "interview",
        message: "You are invited to interview for Office Assistant.",
        Interview: {
            id: 905,
            application_id: 704,
            venue: "Main Office",
            place: "123 Rizal Street",
            date: "2026-11-05",
            time: "09:30",
            contact_info: "jobs@example.invalid",
            what_to_bring: "Portfolio"
        }
    };
    const originalFindByPk = db.Notification.findByPk;
    db.Notification.findByPk = async (id, options) => {
        assert.equal(String(id), "405");
        assert.equal(options.include[0].model, db.Interview);
        return invitation;
    };
    try {
        const res = response();
        await notificationController.getNotificationInterview({
            user: { id: 12 }, params: { id: "405" }
        }, res);
        assert.equal(res.statusCode, 200);
        assert.equal(res.body.Interview.date, "2026-11-05");
        assert.equal(res.body.Interview.what_to_bring, "Portfolio");
    } finally {
        db.Notification.findByPk = originalFindByPk;
    }
});

test("alumni cannot retrieve another user's interview notification", async () => {
    const originalFindByPk = db.Notification.findByPk;
    db.Notification.findByPk = async () => ({
        id: 406,
        userId: 13,
        Interview: { id: 906, venue: "Private Venue" }
    });
    try {
        const res = response();
        await notificationController.getNotificationInterview({
            user: { id: 12 }, params: { id: "406" }
        }, res);
        assert.equal(res.statusCode, 403);
        assert.equal(res.body.msg, "Forbidden");
    } finally {
        db.Notification.findByPk = originalFindByPk;
    }
});
