function inspectConfiguration(env = process.env) {
    const issues = [];
    if (String(env.OBJECT_STORAGE_PROVIDER || 'cloudinary').trim().toLowerCase() !== 'cloudinary') issues.push('unsupported_storage_provider');
    if (['CLOUDINARY_CLOUD_NAME', 'CLOUDINARY_API_KEY', 'CLOUDINARY_API_SECRET'].some(key => !String(env[key] || '').trim())) issues.push('cloudinary_configuration_missing');
    return { policyEnabled: env.ACCOUNT_DELETION_POLICY === 'retain-memberships-v1', storageConfigured: issues.length === 0, issues };
}
module.exports = { inspectConfiguration };
