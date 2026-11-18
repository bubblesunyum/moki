import {
  useInfiniteQuery,
  useQuery,
  type QueryFunctionContext,
  type UseInfiniteQueryOptions,
  type UseQueryOptions,
  type UseQueryResult
} from '@tanstack/react-query'
import type {
  RpcErrorShape,
  RpcMethod,
  RpcParams,
  RpcResult
} from '../../../../../../packages/protocol/src/index'
import { callBridge } from './bridge'

type QueryKey = readonly unknown[]

/** Typed wrapper around `window.moki.call` for one-shot reads. */
export function useRpcQuery<M extends RpcMethod>(
  method: M,
  params?: RpcParams<M>,
  options?: Omit<UseQueryOptions<RpcResult<M>, RpcErrorShape, RpcResult<M>, QueryKey>, 'queryKey' | 'queryFn'>
): UseQueryResult<RpcResult<M>, RpcErrorShape> {
  return useQuery({
    queryKey: ['rpc', method, params ?? null],
    queryFn: () => callBridge(method, params),
    ...options
  })
}

/**
 * Typed infinite-query wrapper for cursor-paged methods: the page param is
 * sent as `cursor` next to `params`, and `getNextPageParam` reads the next
 * cursor (usually `lastPage.next`) off the typed result.
 */
export function useRpcInfiniteQuery<M extends RpcMethod, TCursor = unknown>(
  method: M,
  params: RpcParams<M>,
  getNextPageParam: (
    lastPage: RpcResult<M>,
    allPages: RpcResult<M>[],
    lastPageParam: TCursor,
    allPageParams: TCursor[]
  ) => TCursor | undefined,
  initialPageParam: TCursor,
  options?: Omit<
    UseInfiniteQueryOptions<RpcResult<M>, RpcErrorShape, RpcResult<M>, QueryKey, TCursor>,
    'queryKey' | 'queryFn' | 'initialPageParam' | 'getNextPageParam'
  >
) {
  return useInfiniteQuery({
    queryKey: ['rpc', method, params ?? null],
    queryFn: (ctx: QueryFunctionContext<QueryKey, TCursor>) =>
      callBridge(method, { ...(params as object | undefined), cursor: ctx.pageParam } as never),
    initialPageParam,
    getNextPageParam,
    ...options
  })
}
