import Essay from './essay.mdx';
export default function Page(){return <main data-proofmarks-root><Essay/>{process.env.NODE_ENV==='development'&&process.env.PROOFMARKS_SCRIPT==='1'&&<script src={(process.env.PROOFMARKS_ORIGIN??'http://127.0.0.1:4848')+'/__proofmarks/script.js'}/>}</main>;}
