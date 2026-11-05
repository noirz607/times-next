import { ref, watch, type Ref } from 'vue'

/** 与 localStorage 双向同步的 ref */
export function useStorage<T>(key: string, initial: T): Ref<T> {
  let value = initial
  try {
    const raw = localStorage.getItem(key)
    if (raw != null) value = JSON.parse(raw) as T
  } catch {
    /* 解析失败使用默认值 */
  }
  const state = ref(value) as Ref<T>
  watch(
    state,
    (v) => {
      try {
        localStorage.setItem(key, JSON.stringify(v))
      } catch {
        /* 存储已满或被禁用 */
      }
    },
    { deep: true },
  )
  return state
}
