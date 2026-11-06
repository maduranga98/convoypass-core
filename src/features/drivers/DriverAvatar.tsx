import { Avatar } from '@/components/ui/Avatar'
import { strings } from '@/lib/strings'
import { useDriverPhotoUrl } from '@/features/shared/queries'
import type { Driver, WithId } from '@/types'

/** Photo from the stored path (loaded on demand and cached), or initials. */
export function DriverAvatar({ driver, className }: { driver: Pick<WithId<Driver>, 'name' | 'photoPath' | 'updatedAt'>; className?: string }) {
  const { data } = useDriverPhotoUrl(driver.photoPath, driver.updatedAt?.seconds)
  return <Avatar name={driver.name} src={data ?? null} alt={strings.drivers.photoAlt(driver.name)} {...(className ? { className } : {})} />
}
