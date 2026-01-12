import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  base: '/scoreboard/', // 여기에 저장소 이름을 넣으세요. 예: '/score-board/'
})
