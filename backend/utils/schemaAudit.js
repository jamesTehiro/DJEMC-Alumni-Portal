'use strict';
// Pure comparison helpers: this module never connects, mutates schema, or reads records.
const normalizedType = value => String(value || '').replace(/'(?:''|\\.|[^'])*'|[^']+/g, token => token.startsWith("'") ? token : token.toUpperCase().replace(/INTEGER/g, 'INT').replace(/\b(INT|BIGINT|SMALLINT|MEDIUMINT|TINYINT)\(\d+\)/g, '$1').replace(/\s+/g, ' ').replace(/\s*([(),])\s*/g, '$1')).trim();
const compatibleType = (expected, actual) => normalizedType(expected) === normalizedType(actual) || (normalizedType(expected) === 'JSON' && normalizedType(actual) === 'LONGTEXT');
const indexFields = index => index.fields.map(f => typeof f === 'string' ? f : f.attribute || f.name);
function expectedModel(model, generator) {
 const columns = Object.values(model.rawAttributes).map(a => ({ attribute: a.fieldName, name: a.field, type: a.type.toSql({ escape: generator.escape.bind(generator) }), allowNull: !a.primaryKey && a.allowNull !== false, primaryKey: a.primaryKey === true,
  autoIncrement: a.autoIncrement === true, defaultValue: a.defaultValue == null ? null : typeof a.defaultValue === 'object' ? a.defaultValue.key || 'expression' : a.defaultValue,
  references: a.references ? { table: typeof a.references.model === 'string' ? a.references.model : a.references.model.tableName, column: a.references.key, onDelete: a.onDelete || null, onUpdate: a.onUpdate || null } : null }));
 const indexes = model.options.indexes.map(i => ({ name: i.name, unique: i.unique === true, fields: indexFields(i) }));
 for (const key of Object.values(model.uniqueKeys || {})) {
  if (!indexes.some(i => i.unique && JSON.stringify(i.fields) === JSON.stringify(key.fields))) indexes.push({ name: key.name, unique: true, fields: key.fields });
 }
 return { model: model.name, table: model.getTableName(), timestamps: { enabled: model.options.timestamps, createdAt: model._timestampAttributes.createdAt || null, updatedAt: model._timestampAttributes.updatedAt || null }, columns, indexes,
  associations: Object.values(model.associations).map(a => ({ alias: a.as, type: a.associationType, targetModel: a.target.name, targetTable: a.target.getTableName(), foreignKey: a.foreignKey, through: a.through?.model?.getTableName() || null })) };
}
function compareModel(expected, inventory) {
 const actual = inventory.find(t => t.name === expected.table);
 const caseVariants = inventory.filter(t => t.name !== expected.table && t.name.toLowerCase() === expected.table.toLowerCase()).map(t => t.name);
 const result = { model: expected.model, expectedTable: expected.table, actualTable: actual?.name || null, caseVariants, missingTable: !actual, missingColumns: [], columnDifferences: [], missingIndexes: [], foreignKeyDifferences: [], defaultDifferences: [], extraColumns: [], extraUniqueIndexes: [], queryVerified: false };
 if (!actual) return result;
 for (const col of expected.columns) {
  const found = actual.columns.find(a => a.name === col.name);
  if (!found) { result.missingColumns.push(col.name); continue; }
  for (const [field, want, got] of [['allowNull', col.allowNull, found.allowNull], ['primaryKey', col.primaryKey, found.primaryKey], ['autoIncrement', col.autoIncrement, found.autoIncrement]]) {
   if (want !== got) result.columnDifferences.push({ column: col.name, property: field, expected: want, actual: got });
  }
  if (Object.hasOwn(col, 'defaultValue') && col.defaultValue != null && String(col.defaultValue) !== String(found.defaultValue)) result.defaultDifferences.push({ column: col.name, note: 'Model/application default differs from database default; review without automatic correction' });
  if (!compatibleType(col.type, found.type)) result.columnDifferences.push({ column: col.name, property: 'type', expected: col.type, actual: found.type });
  if (col.references && !actual.foreignKeys.some(fk => fk.column === col.name && fk.targetTable === col.references.table && fk.targetColumn === col.references.column && (!expected.database || !fk.targetDatabase || fk.targetDatabase === expected.database) && (!col.references.onDelete || fk.onDelete === col.references.onDelete) && (!col.references.onUpdate || fk.onUpdate === col.references.onUpdate))) result.foreignKeyDifferences.push({ column: col.name, expected: col.references, actual: actual.foreignKeys.filter(fk => fk.column === col.name) });
 }
 const matches = (want, got) => (!want.unique || got.unique) && JSON.stringify(want.fields) === JSON.stringify(got.fields) && !got.prefix;
 result.missingIndexes = expected.indexes.filter(want => !actual.indexes.some(got => matches(want, got)));
 result.extraColumns = actual.columns.filter(c => !expected.columns.some(e => e.name === c.name)).map(c => c.name);
 result.extraUniqueIndexes = actual.indexes.filter(i => i.unique && i.name !== 'PRIMARY' && !expected.indexes.some(e => e.unique && matches(e, i)));
 return result;
}
module.exports = { expectedModel, compareModel, compatibleType };
