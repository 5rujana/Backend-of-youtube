import {asyncHandler} from "../utils/asyncHandler.js"
import{ApiError} from "../utils/ApiError.js"
import {User} from "../models/user.models.js"
import {UploadOnCloudinary} from "../utils/cloudinary.js"
import { ApiResponse } from "../utils/ApiResponse.js"
import jwt from "jsonwebtoken"

const generateAccessAndRefreshTokens = async (userId) => {
    try {
        const user = await User.findById(userId);
        if (!user) {

            throw new ApiError(404, "User not found");
        }

        const accessToken = user.generateAccessToken();
        const refreshToken = user.generateRefreshToken();
        user.refreshToken = refreshToken;
        await user.save({ validateBeforeSave: false });
        return { accessToken, refreshToken };
    } catch (error) {
        console.error('Error in generateAccessAndRefreshTokens function:', error.message);
        console.error('Stack trace:', error.stack);

        if (error instanceof ApiError) {
            throw error;
        } else {
            throw new ApiError(500, "An error occurred while generating refresh and access tokens");
        }
    }
}; 

const registerUser = asyncHandler(async (req,res) =>{
    // get user details from user (from fronted)
    const {fullname,email,username,password} = req.body
    console.log(`email: ${email}`)
    if([fullname,email,username,password].some((feild)=> feild?.trim()==="")){
        throw new ApiError(400,"All feilds are required")
    }
    //validation - not empty 
    //check if user already exist
    const existingUser = await User.findOne({
        $or:[{username},{email}]
    })

    if(existingUser){
        throw new ApiError(409,"User already exists")
    }
    console.log(req.files) //requested files ig
    //check of images,check for avtar
    const avatarLocalPath = req.files?.avatar[0]?.path
   // const coverImageLocalPath = req.files?.coverImage[0]?.path
    let coverImageLocalPath;
    // we use this check instead of the one mentioned above because
    // if cover image is not uploaded then it will throw error: cannot read properties of undefined
    //prolly cause req.files.coverImage is undefined and uska size 0 hai
    if(req.files && Array.isArray(req.files.coverImage) && req.files.coverImage.length>0){
        coverImageLocalPath = req.files.coverImage[0].path 
    }

    if(!avatarLocalPath){
        throw new ApiError(400,"Avtar is required")
    }
    //upload to cloudinary, avtar
    const avatar = await UploadOnCloudinary(avatarLocalPath)
    const coverImage = coverImageLocalPath ? await UploadOnCloudinary(coverImageLocalPath) : null
    if(!avatar){
        throw new ApiError(500,"Failed to upload image")
    }
    // create user object - create entry in db
    const user = await User.create({
        fullname,
        email,
        username:username.toLowerCase(),
        password,
        avatar:avatar.url,
        coverImage:coverImage?.url || ""
    })
    // remove password and refresh token field from response
    const createdUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )
    //check for user creation
    if(!createdUser){
        throw new ApiError(500,"Failed to register user")
    }
    //return response
    return res.status(201).json(
        new ApiResponse(201,createdUser,"User registered successfully")

    )
 
})

const loginUser = asyncHandler(async(req,res)=>{
    //get login details from user
    const {email,username,password} = req.body
    console.log(email)
    //validation username or email 
    if(!email && !username){
        throw new ApiError(400,"Email and username is required")
    }
    //check if user exists
    const user = await User.findOne({
        $or:[{email},{username}]

    })

    if(!user){
        throw new ApiError(404,"User not found")
    }

    //compare password
    const isPasswordValid = await user.isPasswordMatch(password)

    if(!isPasswordValid){
        throw new ApiError(401,"Invalid user credentials")
    }
    
    //generate access and refresh token
    const {accessToken, refreshToken} = await generateAccessAndRefreshTokens(user._id)
    
    //return response in form of cookies
    const loggedInUser = await User.findById(user._id).select(
        "-password -refreshToken"
    )

    const options ={
        httpOnly : true, //cookie cannot be accessed by js
        secure:true //cookie only sent over https
    }

    return res.status(200)
    .cookie("accessToken",accessToken,options)
    .cookie("refreshToken",refreshToken,options)
    .json(
        new ApiResponse(
            200,
            {
                user: loggedInUser, accessToken,refreshToken

            },
            "User logged in successfully"
        )
    )

})

const logoutUser = asyncHandler(async(req,res)=>{
    //clear cookies
    await User.findByIdAndUpdate(
        req.user._id,
        {
            $set:{
                refreshToken: undefined
            }
        },
        {
            new:true
        }
    )

    const options = {
        httpOnly:true,
        secure:true,
    }

    return res.status(200)
    .clearCookie("accessToken",options)
    .clearCookie("refreshToken",options)
    .json(
        new ApiResponse(200,{}, "User logged out successfully") //{data} par idhar kuch bhi data return nehi kar raha hai
    )
    
})

const refreshAccessToken = asyncHandler(async(req,res)=>{
    const incomingRefreshToken = req.cookies.refreshToken || req.body.refreshToken
    if(!incomingRefreshToken){
        throw new ApiError(401,"Unauthorized request")
    } 

    try {
        const decodedToken = jwt.verify(
            incomingRefreshToken,
            process.env.REFRESH_TOKEN_SECRET
            )
    
        const user = await User.findById(decodedToken._id)
    
        if(!user){
            throw new ApiError(404,'Invalid refresh token')
    
        }
    
        if(user?.refreshToken !== incomingRefreshToken){
            throw new ApiError(401,"Refresh token is expired or used")
        }
    
        const options = {
            httpOnly:true,
            secure:true
        }
    
        const {accessToken,newrefreshToken} = await generateAccessAndRefreshTokens(user._id)
    
        return res.status(200)
        .cookie("accessToken",accessToken,options)
        .cookie("refreshToken",newrefreshToken,options)
        .json(
            new ApiResponse(200,{accessToken,newrefreshToken}, "Access token refreshed successfully")
        )
    } catch (error) {
        throw new ApiError(401,error?.message || "Invalid refresh token ")
    }


})

const changeCurrentPassword = asyncHandler(async(req,res)=>{
    const {oldPassword,newPassword,confPassword} = req.body
    const user = await User.findById(req.user?._id)
    const isPasswordCorrect = await user.isPasswordMatch(oldPassword)

    if(!isPasswordCorrect){
        throw new ApiError(400, "Inva lid old password")
    }

    if(!(newPassword === confPassword)){
        throw new ApiError(402, "Passwords doesn't match")
    }

    if(!(newPassword===oldPassword)){
        throw new ApiError(403, "New password is already used Password")
    }

    user.password = newPassword
    await user.save({validateBeforeSave: false})

    return res
    .status(200)
    .json(new ApiResponse(200,{},"password changed successfully"))
})

const updateAccountDetails = asyncHandler(async(req,res)=>{
    const {fullname, email} = req.body

    if([fullname,email].some((feild)=> feild?.trim()==="")){
        throw new ApiError(400,"All feilds are required")
    }

    const user = await User.findByIdAndUpdate(req.user?._id,
        {
            $set:{
                fullname,
                email
            }
        },
        {
            new:true
        }

    ).select("-password -refreshToken")

    return res
    .status(200)
    .json(new ApiResponse(200,{},"User details updated successfully"))

    
})

const getCurrentUser = asyncHandler(async(req,res)=>{
    const user = await User.findById(req.user?._id).select("-password -refreshToken")
    return res
    .status(200)
    .json(new ApiResponse(200,user,"User details fetched successfully"))
})

const updateUserAvatar = asyncHandler(async(req,res)=>{
    //user
    const avatarLocalPath =  req.file?.path 

    if(!avatarLocalPath){
        throw new ApiError(400,"Avatar file is missing")
    }

    const avatar = await UploadOnCloudinary(avatarLocalPath)

    if(!avatar.url){
        throw new ApiError(400,"Error while uploading on avatar")
    }

    await User.findByIdAndUpdate(req.user?._id,
        {
            $set:{
                avatar:avatar.url
            }
        },
    {new:true}).select("-password -refreshToken")

    //create a utility function to delete the old avatar from cloudinary


    return res
    .status(200)
    .json(new ApiResponse(200,{},"Avatar updated successfully"))
    
})

const updateUserCoverImage = asyncHandler(async(req,res)=>{
    const coverImageLocalPath =  req.file?.path 

    if(!coverImageLocalPath){
        throw new ApiError(400,"Cover Image file is missing")
    }

    const coverImage = await UploadOnCloudinary(coverImageLocalPath)

    if(!coverImage.url){
        throw new ApiError(400,"Error while uploading on cover image")
    }

    await User.findByIdAndUpdate(req.user?._id,
        {
            $set:{
                coverImage:coverImage.url
            }
        },
    {new:true}).select("-password -refreshToken")
    //create a utility function to delete the old coverImage from cloudinary
    return res
    .satatus(200)
    .json(new ApiResponse(200,{},"Cover Image updated successfully"))
    
})

const getUserChannelProfile = asyncHandler(async(req,res)=>{
    const {username} = req.params //we are getting username from the url
    if(!username?.trim()){
        throw new ApiError(404,"Username is missing")
    }

    const channel = await User.aggregate([ //output of aggregate is an array
        {
            $match:{
                username:username.toLowerCase()
            }
        },
        {
            $lookup:{
                from:"Subscriptions",
                localField:"_id",
                foreignField:"channel",
                as:"subscribers"
            }
        },

        {
            $lookup:{
                from:"Subscriptions",
                localField:"_id",
                foreignField:"subscriber",
                as:"subscribedTo"
            
            }
        },
        {
            $addFields:{
                totalSubscribers:{$size:"$subscribers"},
                totalSubscriptions:{$size:"$subscribedTo"},
                isUserSubscribed:{
                    $cond:{
                        if:{ $in:[req.user?._id,"$subscribers.subscriber"]}, // in operator checks in array as well as in object
                        then:true,
                        else:false
                    }}
            
            }
        },

        {
            $project:{
                fullname:1,
                username:1,
                avatar:1,
                coverImage:1,
                totalSubscribers:1,
                totalSubscriptions:1,
                isUserSubscribed:1
            }
        }
     ])

     console.log(channel)
    if(!channel?.length){
        throw new ApiError(404,"Channel not found")
    }

    return res
    .status(200)
    .json(new ApiResponse(200,channel[0],"Channel profile fetched successfully"))
    
}) 

const getWatchHistory = asyncHandler(async(req,res)=>{
    // const user = await User.findById(req.user?._id).populate({
    //     path:"watchHistory.video",
    //     select:"title thumbnail"
    // }) ---> this is the way to populate the video details
    const user =await User.aggregate([
        {
            $match:{
                _id: new mongoose.Types.ObjectId(req.user?._id) // create a new object id from the string id (i.e using _id we are finding mongoose object id)
            }

        },
        {
            $lookup:{
                from: "Videos",
                localField:"watchHistory",
                foreignField:"_id",
                as:"watchHistory",
                pipeline:[
                    {
                        $lookup:{
                        from:"Users",
                        localField:"owner",
                        foreignField:"_id",
                        as:"owner",
                        pipeline:[
                            {
                                $project:{ //this info will be returned in the owner field
                                    fullname:1,
                                    username:1,
                                    avatar:1
                                }
                            }
                        ]
                        }
                    },
                    {
                        $addFields:{
                            $first:"$owner"
                        }
                    }

                ]
            }
        }
    ])

    return res
    .status(200)
    .json(new ApiResponse(200,user[0].watchHistory,"Watch history fetched successfully"))
})

export {registerUser,  
        loginUser,
        logoutUser,
        refreshAccessToken,
        changeCurrentPassword,
        getCurrentUser,
        updateAccountDetails,
        updateUserAvatar,
        updateUserCoverImage,
        getUserChannelProfile,
        getWatchHistory
}