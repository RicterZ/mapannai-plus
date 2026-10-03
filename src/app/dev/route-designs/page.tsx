import { notFound } from 'next/navigation'
import { RouteDesigns } from '@/components/dev/route-designs'

export default function RouteDesignPreview() {
  if (process.env.NODE_ENV !== 'development') notFound()
  return <RouteDesigns />
}
