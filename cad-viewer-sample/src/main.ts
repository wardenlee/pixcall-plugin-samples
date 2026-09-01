import 'element-plus/dist/index.css'
import { i18n, MlCadViewer } from '@mlightcad/cad-viewer'
import ElementPlus from 'element-plus'
import { createApp } from 'vue'
import App from './App.vue'

const app = createApp(App)
app.use(ElementPlus)
app.use(i18n)
app.component('MlCadViewer', MlCadViewer)
app.mount('#app')
