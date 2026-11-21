import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { TripPhoto } from './TripPhoto'

type Arrival = { id: string; photo_uploaded_at: string; scheduled_at: string; requested_note: string | null; departure_address: string; destination_address: string }
export function HospitalPhotoAlerts({ userId, hospitalId }: { userId: string; hospitalId: string }) {
  const [queue,setQueue]=useState<Arrival[]>([])
  const [error,setError]=useState('')
  const dialog=useRef<HTMLDialogElement>(null)
  const key=`ems-photo-ack-${userId}-${hospitalId}`
  const current=queue[0]
  useEffect(()=>{
    const client=supabase
    if(!client)return
    let active=true,fetching=false,initialized=false,cursor='1970-01-01T00:00:00Z'
    const seen=new Set<string>()
    try{const saved=localStorage.getItem(key);if(saved&&!Number.isNaN(Date.parse(saved))){cursor=saved;initialized=true}}catch{/* Notifications still work for this visit. */}
    const load=async()=>{
      if(fetching)return
      fetching=true
      try{
        if(!initialized){
          const baseline=await client.from('reservations').select('photo_uploaded_at').eq('hospital_id',hospitalId).not('photo_uploaded_at','is',null).order('photo_uploaded_at',{ascending:false}).limit(1)
          if(baseline.error)throw baseline.error
          if(!active)return
          cursor=baseline.data[0]?.photo_uploaded_at||cursor;initialized=true
          try{localStorage.setItem(key,cursor)}catch{/* Optional persistence. */}
        }else{
          const arrivals:Arrival[]=[]
          for(let offset=0;;offset+=1000){
            const response=await client.from('reservations').select('id,photo_uploaded_at,scheduled_at,requested_note,departure_address,destination_address').eq('hospital_id',hospitalId).gt('photo_uploaded_at',cursor).order('photo_uploaded_at').order('id').range(offset,offset+999)
            if(response.error)throw response.error
            if(!active)return
            arrivals.push(...response.data as Arrival[])
            if(response.data.length<1000)break
          }
          if(!active)return
          const fresh=arrivals.filter(r=>{const version=`${r.id}:${r.photo_uploaded_at}`;if(seen.has(version))return false;seen.add(version);return true})
          if(fresh.length)setQueue(previous=>[...previous,...fresh])
          if(arrivals.length)cursor=arrivals[arrivals.length-1].photo_uploaded_at
        }
        if(active)setError('')
      }catch{if(active)setError('사진 도착 확인 실패')}
      finally{fetching=false}
    }
    void load()
    const channel=client.channel(`hospital-photo-${userId}`).on('postgres_changes',{event:'UPDATE',schema:'public',table:'reservations',filter:`hospital_id=eq.${hospitalId}`},()=>void load()).subscribe()
    const timer=window.setInterval(()=>void load(),5000)
    const resume=()=>{if(document.visibilityState==='visible')void load()}
    document.addEventListener('visibilitychange',resume);window.addEventListener('online',resume)
    return()=>{active=false;window.clearInterval(timer);document.removeEventListener('visibilitychange',resume);window.removeEventListener('online',resume);void client.removeChannel(channel)}
  },[userId,hospitalId,key])
  useEffect(()=>{if(current&&!dialog.current?.open)dialog.current?.showModal();else if(!current&&dialog.current?.open)dialog.current.close()},[current])
  function dismiss(){
    if(current){try{localStorage.setItem(key,current.photo_uploaded_at)}catch{/* Optional persistence. */}setQueue(previous=>previous.slice(1))}
  }
  return <>{error&&<p className="photo-alert-error" role="status">사진 도착 알림을 확인하지 못했습니다. 연결을 확인해 주세요.</p>}<dialog ref={dialog} className="hospital-photo-dialog" aria-labelledby="photo-arrival-title" onCancel={e=>{e.preventDefault();dismiss()}}>
    {current&&<><h2 id="photo-arrival-title">이송 사진이 도착했습니다</h2><p className="photo-arrival-patient">{current.requested_note?.match(/^환자명:\s*(.+)$/m)?.[1]||'환자명 확인 필요'}</p><p>{new Date(current.scheduled_at).toLocaleString('ko-KR',{timeZone:'Asia/Seoul'})}</p><p>{current.departure_address} → {current.destination_address}</p><p>기사님이 이 예약에 사진 1장을 첨부했습니다. 아래에서 내려받을 수 있습니다.</p><TripPhoto key={`${current.id}:${current.photo_uploaded_at}`} id={current.id} photoAvailable /><button type="button" className="primary-button" onClick={dismiss}>{queue.length>1?`확인 · 다음 알림 ${queue.length-1}건`:'확인하고 닫기'}</button></>}
  </dialog></>
}
