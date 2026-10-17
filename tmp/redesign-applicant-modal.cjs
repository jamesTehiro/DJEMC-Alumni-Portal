const fs = require('fs');
for (const page of ['EmployerPage','AdminEmployerPage']) {
 const path = `frontend/alumni-portal/src/pages/${page}.jsx`;
 let s=fs.readFileSync(path,'utf8').replace(/\r\n/g,'\n');
 s='import ApplicantDocumentWorkspace, { ApplicantResumePrintButton } from "../components/ApplicantDocumentWorkspace";\n'+s;
 const title=s.indexOf('<Modal.Title>Applicant Details</Modal.Title>');
 const start=s.lastIndexOf('\n            <Modal\n',title);
 const body=s.indexOf('                <Modal.Body>',title);
 const end=s.indexOf('                </Modal.Body>',body);
 const footer=s.indexOf('                <Modal.Footer className="applicant-modal-footer">',end);
 const modalEnd=s.indexOf('            </Modal>',footer);
 if([title,start,body,end,footer,modalEnd].some(index=>index<0)) throw Error(`Modal markers missing: ${page}`);
 const before=s.slice(start,body).replace('dialogClassName="resume-dialog"','dialogClassName="resume-dialog applicant-details-dialog"').replace('contentClassName="resume-content"','contentClassName="resume-content applicant-details-content"');
 const oldBody=s.slice(body+'                <Modal.Body>'.length,end);
 const newBody=`                <Modal.Body>
                    {selectedApplication && <ApplicantDocumentWorkspace key={selectedApplication.id} application={selectedApplication} onDownload={downloadApplicationDocument} onView={previewDocumentFile} />}
                    <details className="applicant-extra-details">
                        <summary>Application information</summary>
                        <Button variant="link" size="sm" onClick={handlePrintApplication}>Print Application Summary</Button>
${oldBody}                    </details>
`;
 const tail=s.slice(end,modalEnd).replace(/<Button\b[\s\S]*?Print Application\s*<\/Button>/,'<ApplicantResumePrintButton application={selectedApplication} />');
 s=s.slice(0,start)+before+newBody+tail+s.slice(modalEnd);
 s=s.replaceAll('!documentEntry?.isLegacyResume)', '!documentEntry?.isLegacyResume && !documentEntry?.isLegacyDocument)');
 s=s.replaceAll('documentEntry.file_name || "document"', 'getApplicantDocumentFilename(documentEntry)');
 fs.writeFileSync(path,s);
}
