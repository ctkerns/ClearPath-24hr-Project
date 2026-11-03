import { useTranslation } from 'react-i18next'
import type { MaterialStatus } from '@/components/ui/status-pill'
import { useProductName } from '@/components/library/product-data'
import type { Channel, LiveStatus } from './material-data'
import type { MaterialFilterKey } from './material-filters'

/** Text for one material field value, for example "in_review" becomes "In review". */
export function useOptionLabel() {
  const { t } = useTranslation()
  const productName = useProductName()
  return (key: MaterialFilterKey, value: string): string => {
    switch (key) {
      case 'status': return t(`status.${value as MaterialStatus}`)
      case 'live': return t(`materials.liveStatus.${value as LiveStatus}`)
      case 'channel': return t(`materials.channel.${value as Channel}`)
      case 'product': return productName(value)
      default: return value
    }
  }
}
