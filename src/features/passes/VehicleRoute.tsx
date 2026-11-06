import { useParams } from 'react-router-dom'
import { useSession } from '@/features/auth/useAuth'
import GateVehicleView from '@/features/gate/GateVehicleView'
import DriverVehicleGate from './DriverVehicleGate'

/**
 * `/v/:vehicleId` (behind the login redirect): drivers get the pre-trip flow; security the gate view with Check in and
 * Deny; admin, officer and supervisor the same gate view read-only (a supervisor only sees what the rules allow).
 */
export default function VehicleRoute() {
  const { vehicleId = '' } = useParams()
  const { claims } = useSession()
  if (claims.role === 'driver') return <DriverVehicleGate vehicleId={vehicleId} />
  return <GateVehicleView key={vehicleId} vehicleId={vehicleId} readOnly={claims.role !== 'security'} />
}
