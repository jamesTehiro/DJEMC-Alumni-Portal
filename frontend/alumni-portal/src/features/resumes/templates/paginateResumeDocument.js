export const A4_WIDTH_PX = 210 * 96 / 25.4;
export const A4_HEIGHT_PX = 297 * 96 / 25.4;

// Both the preview and PDF use this measured, unscaled document. Entries move as
// units; a description longer than a page is split at a word boundary.
export function paginateResumeDocument(source, stage) {
    const ownerDocument = source.ownerDocument;
    const pages = [];
    const originalHeader = source.querySelector(".djemc-resume-header");
    const originalBody = source.querySelector(".djemc-resume-body");
    const fullName = source.querySelector(".djemc-resume-name")?.textContent || "Resume";
    let page;
    let body;

    function nextPage() {
        if (pages.length >= 200) throw new Error("This resume is too long to preview. Shorten the content and try again.");
        page = source.cloneNode(false);
        page.classList.add("djemc-resume-page");
        page.setAttribute("data-page-number", String(pages.length + 1));
        if (!pages.length && originalHeader) {
            page.appendChild(originalHeader.cloneNode(true));
        } else {
            const header = ownerDocument.createElement("header");
            header.className = "djemc-resume-continuation-header";
            const name = ownerDocument.createElement("strong");
            name.textContent = fullName;
            const label = ownerDocument.createElement("span");
            label.textContent = "Resume · Continued";
            header.append(name, label);
            page.appendChild(header);
        }
        body = originalBody.cloneNode(false);
        page.appendChild(body);
        stage.appendChild(page);
        pages.push(page);
    }

    function fits() {
        const style = ownerDocument.defaultView.getComputedStyle(page);
        const allowedBottom = page.getBoundingClientRect().bottom - parseFloat(style.paddingBottom) - 2;
        return body.getBoundingClientRect().bottom <= allowedBottom;
    }

    function newSection(original, continued = false) {
        const section = original.cloneNode(false);
        const heading = original.querySelector(".djemc-resume-section-heading").cloneNode(true);
        if (continued) {
            const suffix = ownerDocument.createElement("span");
            suffix.className = "djemc-resume-section-continued";
            suffix.textContent = "Continued";
            heading.appendChild(suffix);
        }
        const entries = original.querySelector(".djemc-resume-section-entries").cloneNode(false);
        section.append(heading, entries);
        body.appendChild(section);
        return { section, entries };
    }

    nextPage();
    if (!fits()) throw new Error("Your name or contact details are too long for the A4 header. Shorten those fields and save again.");
    for (const originalSection of originalBody.children) {
        let { section, entries } = newSection(originalSection);
        const moveSection = () => {
            if (!entries.children.length) section.remove();
            nextPage();
            ({ section, entries } = newSection(originalSection, true));
        };
        const originals = originalSection.querySelector(".djemc-resume-section-entries").children;
        for (const originalEntry of originals) {
            const whole = originalEntry.cloneNode(true);
            entries.appendChild(whole);
            if (fits()) continue;
            whole.remove();
            // Try an intact entry on the next page before splitting its text.
            if (body.children.length > 1 || entries.children.length) moveSection();
            entries.appendChild(whole);
            if (fits()) continue;
            whole.remove();

            let partial = originalEntry.cloneNode(false);
            entries.appendChild(partial);
            const continueEntry = () => {
                if (!partial.children.length) partial.remove();
                moveSection();
                partial = originalEntry.cloneNode(false);
                partial.classList.add("djemc-resume-entry-fragment");
                const title = originalEntry.querySelector(".djemc-resume-entry-title")?.textContent;
                if (title) {
                    const context = ownerDocument.createElement("p");
                    context.className = "djemc-resume-entry-continuation";
                    context.textContent = `${title.length > 120 ? `${title.slice(0, 117)}...` : title} · Continued`;
                    partial.appendChild(context);
                }
                entries.appendChild(partial);
            };
            for (const originalPart of originalEntry.children) {
                let remaining = originalPart.textContent;
                let part = originalPart.cloneNode(true);
                partial.appendChild(part);
                if (fits()) continue;
                part.remove();
                while (remaining.length) {
                    part = originalPart.cloneNode(false);
                    partial.appendChild(part);
                    let low = 0;
                    let high = remaining.length;
                    while (low < high) {
                        const middle = Math.ceil((low + high) / 2);
                        part.textContent = remaining.slice(0, middle);
                        if (fits()) low = middle;
                        else high = middle - 1;
                    }
                    if (!low) {
                        part.remove();
                        // The compact continuation heading always leaves space for
                        // at least one text line at the supported font sizes.
                        continueEntry();
                        continue;
                    }
                    if (low < remaining.length) {
                        const lastSpace = remaining.slice(0, low).search(/\s+\S*$/);
                        if (lastSpace > low * 0.65) low = lastSpace + 1;
                    }
                    part.textContent = remaining.slice(0, low);
                    remaining = remaining.slice(low);
                    if (remaining.length) continueEntry();
                }
            }
        }
    }
    for (const [index, element] of pages.entries()) {
        const footer = ownerDocument.createElement("footer");
        footer.className = "djemc-resume-page-footer";
        footer.textContent = `${index + 1} / ${pages.length}`;
        element.appendChild(footer);
    }
    return pages;
}
