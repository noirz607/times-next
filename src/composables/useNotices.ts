import { ref } from 'vue'
import type { NoticesFile } from '../types/notice.ts'

export function useNotices() {
  const data = ref<NoticesFile | null>(null)
  const loading = ref(true)
  const error = ref<string | null>(null)

  async function load() {
    loading.value = true
    error.value = null
    try {
      const res = await fetch(`${import.meta.env.BASE_URL}notices.json`, { cache: 'no-cache' })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      data.value = (await res.json()) as NoticesFile
    } catch (e) {
      error.value = e instanceof Error ? e.message : String(e)
    } finally {
      loading.value = false
    }
  }

  load()
  return { data, loading, error, reload: load }
}
