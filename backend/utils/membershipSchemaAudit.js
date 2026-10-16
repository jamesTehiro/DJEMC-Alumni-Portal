'use strict';

// Mirrors GET /api/membership/me only. Consumes schema metadata, never user rows.
function membershipReadSchema(expected, inventory) {
 const reads = [
  { model: 'User', attributes: ['id', 'name', 'email', 'role', 'admin_scope', 'account_status', 'alumni_record_id'] },
  { model: 'MembershipApplication', attributes: null }, // findOne selects every modeled column.
  { model: 'AlumniProfile', attributes: ['id', 'user_id', 'phone', 'address', 'course', 'graduation_year', 'job_title', 'current_company'] },
  { model: 'AlumniRecord', attributes: ['id', 'course', 'batch_year'], condition: 'user.alumni_record_id is set' },
  { model: 'EmploymentHistory', attributes: ['id', 'alumni_id', 'company_name', 'position', 'start_year', 'end_year', 'employment_type'], condition: 'an alumni profile exists' }
 ];
 const dependencies = reads.map(read => {
  const model = expected.find(item => item.model === read.model);
  if (!model) return { model: read.model, condition: read.condition || null, status: 'model_unregistered' };
  const attributes = read.attributes || model.columns.map(column => column.attribute);
  const requiredColumns = attributes.map(attribute => model.columns.find(column => column.attribute === attribute)?.name || attribute);
  const actual = inventory.find(table => table.name === model.table);
  const missingColumns = actual ? requiredColumns.filter(name => !actual.columns.some(column => column.name === name)) : requiredColumns;
  return {
   model: read.model, table: model.table, condition: read.condition || null,
   actualTable: actual?.name || null,
   caseVariants: inventory.filter(table => table.name !== model.table && table.name.toLowerCase() === model.table.toLowerCase()).map(table => table.name),
   requiredColumns, missingColumns,
   status: !actual ? 'missing_table' : missingColumns.length ? 'missing_columns' : 'available'
  };
 });
 return {
  endpoint: 'GET /api/membership/me',
  baseReadsResolvable: dependencies.filter(read => !read.condition).every(read => read.status === 'available'),
  allReadsResolvable: dependencies.every(read => read.status === 'available'),
  dependencies,
  note: 'Metadata only; does not verify authentication, account status, record values, grants, or a live request. Conditional reads depend on the signed-in account. MembershipAdministrator and EmailQueueJob are not dependencies of this endpoint.'
 };
}

module.exports = { membershipReadSchema };
