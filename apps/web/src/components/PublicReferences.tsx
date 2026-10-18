type Row=Record<string,unknown>;
const object=(value:unknown):Row=>value&&typeof value==='object'&&!Array.isArray(value)?value as Row:{};
const providers:Record<string,string>={nts:'국세청',dart:'DART 공시',law:'국가법령정보',ecos:'한국은행 ECOS'};
export function PublicApiStatus({configuration}:{configuration:unknown}){
  const config=object(configuration),mode=String(config.mode??'unknown');
  return <section className="notice public-api-status"><strong>공공자료 연결 · {mode==='live'?'실조회 모드':mode==='gateway'?'공유 중계 연결':mode==='mock'?'샘플 모드':mode==='preview'?'보관된 예시 자료':'확인 중'}</strong>
    <p>{mode==='preview'?'공개 화면에서는 미리 수집한 예시를 보여 줍니다. 각 자료의 실제/샘플 구분과 조회 시각을 확인하세요.':mode==='mock'?'공공 조회 도구가 샘플을 반환합니다.':mode==='unknown'?'서버 설정을 확인하고 있습니다.':'회계 입력 조회·분개 초안 생성 시 참고자료를 수집합니다. 실제 응답 여부는 각 자료의 출처 표시로 확인하세요.'}</p>
    <span>외부 공시·법령·금리를 가상회사의 거래 금액으로 합산하지 않습니다.</span></section>;
}
export function PublicSiteNotice({snapshotAt}:{snapshotAt:string}){
  return <section className="notice data-origin-note" aria-label="공개 미리보기 안내"><strong>둘러보는 예시 · 내 연습 장부와는 달라요</strong><p>학습용으로 만든 가상 거래 1,000건과 공공자료 예시입니다. Google로 로그인하면 내 전용 연습 장부가 준비됩니다. ‘처음 사용하기’의 요청문을 AI 앱에 보내고 거래 한 건부터 공부해 보세요.</p><p>아직 장부에 반영한 전표가 없어서 보고서는 ‘장부 반영 전’으로 표시됩니다. 예시 자료 준비 시각: {snapshotAt||'확인 중'}</p><a href="/workflow/">처음 연결부터 보고서까지 학습 순서 →</a></section>;
}
export function PublicReferences({report}:{report:unknown}){
  const value=object(report),items=Array.isArray(value.items)?value.items.map(object):[];
  if(!items.length)return <section className="public-reference-panel"><h3>공공자료 검토</h3><p>이 전표에는 공공자료 snapshot이 없습니다. 새 분개 초안부터 조회 결과가 포함됩니다.</p></section>;
  return <section className="public-reference-panel"><h3>공공자료 검토 근거</h3><p>거래 기준일 {String(value.transactionDate)} · 새 분개 초안에는 조회 결과가 승인 대상 내용에 포함됩니다. 공공자료 메뉴의 참고 조회는 전표를 변경하지 않습니다. 금액·계정을 자동 변경하거나 법률·회계 판단을 확정하지 않습니다.</p>
    <div className="public-reference-grid">{items.map((item,index)=>{const p=object(item.provenance),status=item.status==='not_applicable'?'조회 제외':item.status==='unavailable'?'확인 필요':p.origin==='public_api_live'?'실제 공공자료':'샘플 자료';
      return <article key={index}><div><strong>{providers[String(item.provider)]??String(item.provider)}</strong><span className={'reference-status '+String(item.status)}>{status}</span></div>
        <h4>{String(item.purpose)}</h4><p>{String(item.note)}</p>
        {Boolean(p.sourceUrl)&&<a href={String(p.sourceUrl)} target="_blank" rel="noopener noreferrer">공식 출처 ↗</a>}
        {Boolean(p.fetchedAt)&&<small>조회: {String(p.fetchedAt)}{p.cacheHit===true?' · 캐시 재사용':''}</small>}
        {Boolean(item.errorCode)&&<small>확인 코드: {String(item.errorCode)}</small>}
        {Boolean(item.facts)&&<details><summary>조회 요약과 적용 기준일 보기</summary><pre>{JSON.stringify(item.facts,null,2)}</pre></details>}
      </article>;
    })}</div></section>;
}
