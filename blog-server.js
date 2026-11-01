import http from 'http';
import https from 'https';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { URL } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// .env 파일 로드
function loadEnv() {
  const env = {};
  try {
    const envPath = path.join(__dirname, '.env');
    const envFile = fs.readFileSync(envPath, 'utf8');
    envFile.split('\n').forEach(line => {
      const [key, ...values] = line.split('=');
      if (key && values.length) {
        env[key.trim()] = values.join('=').trim();
      }
    });
  } catch (err) {
    console.error('⚠️  .env 파일을 찾을 수 없습니다. .env 파일을 생성해주세요.');
  }
  return env;
}

const ENV = loadEnv();
const PORT = 3000;

// OpenRouter API 호출
function callOpenRouter(messages, callback) {
  const isDryRun = ENV.DRY_RUN === '1';

  if (isDryRun) {
    // 테스트 모드: 가짜 응답 반환
    setTimeout(() => {
      callback(null, JSON.stringify({
        choices: [{
          message: {
            content: '테스트 응답입니다 (DRY_RUN=1)'
          }
        }]
      }));
    }, 1000);
    return;
  }

  const data = JSON.stringify({
    model: 'anthropic/claude-sonnet-4.5',
    messages: messages
  });

  const options = {
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${ENV.OPENROUTER_API_KEY}`,
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data)
    }
  };

  const req = https.request(options, (res) => {
    let responseData = '';

    res.on('data', (chunk) => {
      responseData += chunk;
    });

    res.on('end', () => {
      if (res.statusCode === 200) {
        callback(null, responseData);
      } else {
        callback(new Error(`API 오류: ${res.statusCode} - ${responseData}`));
      }
    });
  });

  req.on('error', (err) => {
    callback(err);
  });

  req.write(data);
  req.end();
}

// HTTP 서버
const server = http.createServer((req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host}`);

  // CORS 헤더
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.writeHead(200);
    res.end();
    return;
  }

  // 루트: blog-index.html 제공
  if (parsedUrl.pathname === '/' && req.method === 'GET') {
    fs.readFile(path.join(__dirname, 'blog-index.html'), 'utf8', (err, data) => {
      if (err) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('blog-index.html 파일을 찾을 수 없습니다.');
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(data);
    });
    return;
  }

  // API: 스타일 분석
  if (parsedUrl.pathname === '/api/analyze-style' && req.method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { referencePosts } = JSON.parse(body);

        const messages = [
          {
            role: 'user',
            content: `당신은 네이버 블로그 글쓰기 스타일 분석 전문가입니다.
아래 참고 글들을 꼼꼼히 읽고, 실제로 사용된 스타일을 정확하게 추출해주세요.

참고 글:
---
${referencePosts}
---

중요: 위 글에서 **실제로 사용된 패턴**을 찾아내야 합니다. 추측하지 마세요.

분석 항목:

1. tone (말투):
   실제 문장 끝을 보고 정확히 분류하세요:

   - 반말 (구어체): "~해", "~야", "~지", "~거든", "~네"
     예: "오늘 다녀왔어", "진짜 맛있더라", "추천할게"

   - 해요체 (존댓말): "~해요", "~예요", "~이에요", "~어요"
     예: "다녀왔어요", "맛있어요", "추천해요"

   - 합니다체 (격식체): "~합니다", "~습니다", "~입니다"
     예: "방문했습니다", "맛있습니다", "추천합니다"

   - 한다체 (문어체): "~한다", "~다", "~ㄴ다", "~는다"
     예: "방문했다", "맛있다", "추천한다"

   글 전체에서 가장 많이 나오는 문장 종결 형태를 찾으세요.
   반말/존댓말만 구분하지 말고, 구어체/문어체도 명확히 구분하세요.

2. subheadings (소제목):
   - 실제로 몇 개 사용되었나요?
   - 이모지가 있나요? 어떤 패턴인가요?
   - 예: "3개, 🌟 이모지 + 한글", "4개, 번호 없이 굵게만"

3. paragraphLength (문단 길이):
   - 한 문단이 몇 줄인가요? (1~2줄? 3~5줄? 길게?)
   - 짧은 문장인가요, 긴 문장인가요?

4. photoPlacement (사진 위치):
   - 사진 언급이 있나요?
   - 어디에 넣는다고 했나요?
   - 없으면 "사진 언급 없음"

5. hashtagCount (해시태그):
   - 실제로 몇 개 사용했나요?
   - 태그 스타일은? (길이, 종류)

6. introFormula (도입부):
   - 글 시작 1~2문장의 실제 패턴을 찾으세요
   - 예: "안녕! 오늘은~", "요즘 핫한 ~"

7. closingFormula (마무리):
   - 글 끝 1~2문장의 실제 패턴을 찾으세요
   - 예: "다음에 또 올게~", "도움 됐으면 좋겠어!"

JSON만 출력하세요 (설명 없이):
{
  "tone": "정확한 말투 (반말/존댓말 명시)",
  "subheadings": "개수와 형태",
  "paragraphLength": "실제 길이",
  "photoPlacement": "사진 위치 패턴",
  "hashtagCount": "N개",
  "introFormula": "실제 도입부 예시",
  "closingFormula": "실제 마무리 예시"
}`
          }
        ];

        callOpenRouter(messages, (err, response) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }

          try {
            const result = JSON.parse(response);
            const content = result.choices[0].message.content;

            // JSON 추출 (마크다운 코드 블록 제거)
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const styleData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(styleData));
          } catch (parseErr) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'AI 응답 파싱 실패', details: response }));
          }
        });

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '잘못된 요청' }));
      }
    });
    return;
  }

  // API: 글 생성
  if (parsedUrl.pathname === '/api/generate-post' && req.method === 'POST') {
    let body = '';

    req.on('data', chunk => {
      body += chunk.toString();
    });

    req.on('end', () => {
      try {
        const { keyword, style, storeInfo } = JSON.parse(body);

        const messages = [
          {
            role: 'user',
            content: `당신은 네이버 블로그 글 작성 전문가입니다.
아래 정보를 바탕으로 블로그 글을 작성해주세요.

키워드: ${keyword}

가게 정보:
- 상호: ${storeInfo.name}
- 업종: ${storeInfo.type}
- 지역: ${storeInfo.location}
- 강조점: ${storeInfo.highlights}

스타일 가이드 (반드시 100% 따라야 함):
- 말투: ${style.tone}
  → 반말이면: "~해", "~야", "~지", "~거든" (구어체)
  → 해요체면: "~해요", "~예요", "~어요" (구어체 존댓말)
  → 합니다체면: "~합니다", "~습니다", "~입니다" (격식체)
  → 한다체면: "~한다", "~다", "~ㄴ다" (문어체)
  → 정확히 이 스타일만 사용할 것! 절대 섞지 말 것!

- 소제목: ${style.subheadings}
  → **별표로 감싸서** 표시 (예: **여기가 포인트**)
  → 개수와 형태 정확히 지킬 것

- 문단 길이: ${style.paragraphLength}
  → 한 문단의 줄 수를 정확히 맞출 것

- 사진 위치: ${style.photoPlacement}
  → [사진 1 - 구체적 설명] 형식으로 표시
  → 예: [사진 1 - 매장 입구 전경]

- 해시태그: ${style.hashtagCount}

- 도입부: ${style.introFormula}
  → 이 패턴을 참고해서 자연스럽게 시작

- 마무리: ${style.closingFormula}
  → 이 패턴을 참고해서 자연스럽게 마무리

출력 형식 (JSON만):
{
  "title": "제목 (40자 이내, 클릭 유도)",
  "body": "본문 (순수 텍스트, HTML 태그 NO)",
  "hashtags": ["태그1", "태그2"]
}

절대 규칙:
1. 말투 통일 (반말이면 끝까지 반말, 존댓말이면 끝까지 존댓말)
2. 소제목은 **별표**로만 표시
3. 문단 사이 빈 줄로 구분
4. [사진] 자리표시 꼭 넣기
5. 자연스럽고 유용한 정보 위주로 작성
6. 광고성 과장 표현 자제`
          }
        ];

        callOpenRouter(messages, (err, response) => {
          if (err) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: err.message }));
            return;
          }

          try {
            const result = JSON.parse(response);
            const content = result.choices[0].message.content;

            // JSON 추출
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            const postData = jsonMatch ? JSON.parse(jsonMatch[0]) : JSON.parse(content);

            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify(postData));
          } catch (parseErr) {
            res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
            res.end(JSON.stringify({ error: 'AI 응답 파싱 실패', details: response }));
          }
        });

      } catch (err) {
        res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: '잘못된 요청' }));
      }
    });
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('페이지를 찾을 수 없습니다.');
});

server.listen(PORT, () => {
  console.log(`\n🚀 네이버 블로그 글 생성기 시작!`);
  console.log(`📱 브라우저에서 열기: http://localhost:${PORT}`);
  console.log(`\n.env 파일 상태:`);
  console.log(`  - OPENROUTER_API_KEY: ${ENV.OPENROUTER_API_KEY ? '✅ 설정됨' : '❌ 없음'}`);
  console.log(`  - DRY_RUN: ${ENV.DRY_RUN === '1' ? '테스트 모드' : '실제 모드'}`);
  console.log(`\n종료하려면 Ctrl+C를 누르세요.\n`);
});
