export const ADMIN_USERS_PER_PAGE = 10;

export function paginateAdminUsers(users, requestedPage) {
    const total = users.length;
    const pageCount = Math.max(1, Math.ceil(total / ADMIN_USERS_PER_PAGE));
    const page = Math.min(Math.max(1, requestedPage), pageCount);
    const offset = (page - 1) * ADMIN_USERS_PER_PAGE;
    return {
        page, pageCount, total,
        start: total ? offset + 1 : 0,
        end: Math.min(offset + ADMIN_USERS_PER_PAGE, total),
        users: users.slice(offset, offset + ADMIN_USERS_PER_PAGE)
    };
}
