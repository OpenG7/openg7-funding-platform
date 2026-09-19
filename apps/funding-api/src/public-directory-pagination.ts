export interface PublicDirectoryPagination {
  readonly page: number;
  readonly pageSize: number;
}

export function parsePublicDirectoryPagination(
  params: URLSearchParams,
  defaultPageSize = 50
): PublicDirectoryPagination | null {
  const page = params.get('page') ?? '1';
  const size = params.get('pageSize') ?? String(defaultPageSize);
  if (
    params.getAll('page').length > 1 ||
    params.getAll('pageSize').length > 1 ||
    !/^[1-9]\d*$/.test(page) ||
    !/^[1-9]\d*$/.test(size) ||
    Number(page) > 100_000 ||
    Number(size) > 50
  )
    return null;
  return { page: Number(page), pageSize: Number(size) };
}
