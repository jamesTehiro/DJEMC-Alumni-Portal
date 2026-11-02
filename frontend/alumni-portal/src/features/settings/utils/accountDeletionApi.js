import { api } from '../../../services/api';
export function deletionFailure(error) {
    if (error?.code === 'API_ROUTE_NOT_FOUND' || (error?.status === 404 && error?.contentType?.includes('text/html'))) {
        return 'The deletion API endpoint was not found. Verify that the configured backend deployment includes account deletion. No deletion was confirmed.';
    }
    return error?.message || 'Unable to complete the deletion request.';
}
export async function loadDeletionImpact(endpoint, id) {
    const result = await api.get(`${endpoint}/${id}/deletion-impact`, true);
    if (typeof result === 'string') throw new Error('The deletion API returned a non-JSON response. Verify the configured API URL and backend deployment.');
    const counts = value => value && typeof value === 'object' && !Array.isArray(value) && Object.values(value).every(count => Number.isSafeInteger(count) && count >= 0);
    if (!counts(result?.counts) || (result.preserved != null && !counts(result.preserved)) || typeof result.canDelete !== 'boolean'
        || !Array.isArray(result.blockers) || result.blockers.some(value => typeof value !== 'string')) {
        throw new Error('The deletion API returned an invalid impact preview. Refresh the preview or verify the backend version.');
    }
    return result;
}
