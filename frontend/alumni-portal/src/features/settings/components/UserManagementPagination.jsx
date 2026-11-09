import { Fragment } from "react";

export default function UserManagementPagination({ pagination, onPageChange }) {
    const { page, pageCount, total, start, end } = pagination;
    const pageNumbers = [...new Set([1, ...Array.from({ length: 5 }, (_, index) => page - 2 + index)
        .filter(number => number > 1 && number < pageCount), pageCount])];

    return <footer className="admin-user-pagination">
        <span className="admin-user-page-count" role="status" aria-live="polite">
            Showing {start}–{end} of {total} users
        </span>
        {pageCount > 1 && <nav aria-label="User management pagination">
            <button type="button" disabled={page === 1} onClick={() => onPageChange(page - 1)}>Previous</button>
            {pageNumbers.map((number, index) => <Fragment key={number}>
                {index > 0 && number - pageNumbers[index - 1] > 1 && <span className="admin-user-page-gap" aria-hidden="true">…</span>}
                <button type="button" aria-label={`Page ${number}`} aria-current={number === page ? "page" : undefined}
                    onClick={() => onPageChange(number)}>{number}</button>
            </Fragment>)}
            <button type="button" disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>Next</button>
        </nav>}
    </footer>;
}
