const passage = 'A small community garden can teach people how to learn together. At first, each volunteer worked alone and followed a different plan. Some planted seeds too early, while others forgot to water them. The group then began to share observations at a weekly meeting. They compared the shaded beds with the sunny ones and recorded the results in a notebook. Over time, their questions became more precise. Instead of asking whether a plant was good or bad, they asked which conditions helped it grow. This simple change made cooperation easier. A mistake was no longer a reason to blame someone; it became information that everyone could use. The garden improved because the volunteers treated learning as a shared process.';
const types = ['주장','요지','주제','제목','함축의미','내용일치','내용불일치','선택어법','선택어휘','밑줄어법','밑줄어휘','빈칸','무관문','순서','삽입','요약'];
const defaultChoices = ['Learning is strengthened by shared observation.', 'Good results require everyone to work alone.', 'Precise questions make cooperation impossible.', 'Mistakes should be hidden from other volunteers.', 'Every plant grows under the same conditions.'];
module.exports = types.map((type, index) => {
  const textStructure = {templateKey:'objective-common',questionText:'다음 글의 내용으로 가장 적절한 것은?',bodyText:passage,choices:defaultChoices.map(text=>({text}))};
  if (type === '함축의미') textStructure.bodyText = passage.replace('a shared process','[[u:a shared process]]');
  if (type === '빈칸') textStructure.bodyText = passage.replace('a shared process','[[blank]]');
  if (['밑줄어법','밑줄어휘'].includes(type)) {
    textStructure.templateKey='objective-body-only';
    textStructure.bodyText=passage.replace('teach','[[u:① teach]]').replace('worked','[[u:② worked]]').replace('precise','[[u:③ precise]]').replace('cooperation','[[u:④ cooperation]]').replace('improved','[[u:⑤ improved]]');
    textStructure.choices=[];
  }
  if (['선택어법','선택어휘'].includes(type)) {
    textStructure.templateKey='objective-abc';
    textStructure.bodyText=passage.replace('teach','[[box:A:teach|teaching]]').replace('worked','[[box:B:worked|working]]').replace('precise','[[box:C:precise|precisely]]');
    textStructure.choices=['(A) teach / (B) worked / (C) precise','(A) teaching / (B) worked / (C) precise','(A) teach / (B) working / (C) precisely','(A) teaching / (B) working / (C) precise','(A) teach / (B) worked / (C) precisely'].map(text=>({text}));
  }
  if(type==='순서') {
    textStructure.templateKey='objective-sequence';
    textStructure.questionText='주어진 글 다음에 이어질 글의 순서로 가장 적절한 것은?';
    textStructure.givenText='A community garden became a place for people to learn together.';
    textStructure.bodyText='(A) They began to share their observations. Everyone brought a notebook and described what they had seen.\n\n(B) At first, each volunteer worked alone. The results were different and the group did not understand why.\n\n(C) In the end, they learned to ask precise questions. Their shared work made the garden healthier.';
    textStructure.choices=['A-B-C','A-C-B','B-A-C','B-C-A','C-A-B'].map(text=>({text}));
  }
  if(type==='삽입') {
    textStructure.templateKey='objective-insertion';
    textStructure.questionText='글의 흐름으로 보아 주어진 문장이 들어가기에 가장 적절한 곳은?';
    textStructure.givenText='This change allowed them to learn from one another.';
    textStructure.bodyText=passage.replaceAll('. ','. [[s]] ');
    textStructure.choices=[];
  }
  if(type==='무관문') {
    textStructure.templateKey='objective-body-only';
    textStructure.bodyText='Gardens help people cooperate. ① They share tools and observations. ② They discuss the weather and soil. ③ Some distant planets have rings made of ice. ④ Each volunteer learns to ask better questions. ⑤ The team becomes stronger through this work.';
    textStructure.choices=[];
  }
  if(type==='요약') {
    textStructure.templateKey='objective-summary-ab';
    textStructure.questionText='다음 글을 한 문장으로 요약하고자 한다. 빈칸 (A), (B)에 들어갈 말로 가장 적절한 것은?';
    textStructure.summaryText='By making [[blank:A]] observations, the volunteers turned mistakes into opportunities for [[blank:B]].';
    textStructure.choices=['(A) shared / (B) learning','(A) private / (B) conflict','(A) careless / (B) blame','(A) repeated / (B) silence','(A) narrow / (B) failure'].map(text=>({text}));
  }
  return {recordId:'qa-solbook-'+(index+1),kind:'problem',number:index+1,problemType:type,textStructure,answerText:'①',explanationText:'QA fixture',textbookName:'Text format QA',segmentMeta:[{x0:0,y0:0,x1:500,y1:600}],segmentStoragePaths:['qa/must-not-fetch.png']};
});
