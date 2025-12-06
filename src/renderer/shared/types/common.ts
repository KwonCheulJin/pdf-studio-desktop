/**
 * 공통 유틸리티 타입
 */

/**
 * 객체 타입의 값들의 유니온 타입을 추출합니다.
 *
 * @example
 * const STATUS = { IDLE: 'idle', LOADING: 'loading' } as const;
 * type Status = ValueOf<typeof STATUS>; // 'idle' | 'loading'
 */
export type ValueOf<T> = T[keyof T];
